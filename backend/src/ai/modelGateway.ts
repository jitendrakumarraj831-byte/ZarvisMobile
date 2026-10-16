import { randomUUID } from "node:crypto";
import { correlationFields } from "../observability/requestContext.js";
import { logger } from "../security/redact.js";
import { requirementsFor, type Requirements } from "./capabilities.js";
import { withAttemptContext, type AttemptContext, type ModelCallRecord } from "./callTrace.js";
import { cooldownReasonFor, fallbackReasonFor, isFallbackEligibleKind, type AttemptSummary, type FallbackReasonCode } from "./errorTaxonomy.js";
import { AIProviderError, abortError } from "./geminiErrors.js";
import { IMAGE_ANALYSIS_MAX_OUTPUT_TOKENS, IMAGE_ANALYSIS_SYSTEM_PROMPT, IMAGE_ANALYSIS_USER_PROMPT } from "./imageAnalysisPrompts.js";
import { chooseEntry, describeEntry, type CatalogProvider, type ModelEntry } from "./modelCatalog.js";
import type { DynamicCatalog } from "./openRouterModels.js";
import type {
  AICallMeta,
  AIProvider,
  AIRequest,
  AIResponse,
  AIResponseChunk,
  ImageAnalysisResult,
  ModelConfiguration,
  ProviderTrace,
  ToolDefinition,
} from "./provider.js";
import { isAbortError, isTransportError, transportFailure } from "./transportErrors.js";
import type { KeyRotator, KeyRotatorStatus } from "../security/keyRotator.js";

/**
 * ZARVIS AI Model Gateway: the one place that decides which AI provider and model answers a
 * request. The orchestrator, the content-generation skills and the image route call the gateway;
 * none of them names a vendor. It is itself an `AIProvider`, so everything that already accepted
 * a provider accepts the gateway unchanged.
 *
 * What it does, in order, for every logical call (see ../../AI_MODEL_GATEWAY.md):
 *
 * 1. **Capability routing.** It derives what the request needs (tools, vision, structured output,
 *    streaming, a context that fits, anything the caller `requires`) and picks the most
 *    preferred enabled model that *declares* all of it. A model is never made to "work" by
 *    dropping tools or an image; if nothing can serve the request it fails with
 *    AI_PROVIDER_CAPABILITY_UNSUPPORTED.
 * 2. **An ordered fallback chain.** The providers are tried one after another, in the configured
 *    order (default: Gemini, then OpenRouter, then the OpenAI-compatible endpoint; a provider without
 *    credentials is left out). The chain starts only when the primary fails with a provider-side
 *    condition another provider can answer: a rate limit, an exhausted quota, an outage, a timeout,
 *    or a 404 (the model is not offered to this account). Authentication errors, invalid requests,
 *    a capability gap found by routing and internal errors of the primary never start it, so a real
 *    bug or a revoked key is not hidden behind another provider. Once it has started, a fallback's
 *    own rejected key or missing model moves on to the next provider too (it is that provider's
 *    problem, not the request's); a refused request or a bug still ends the call. Each provider is
 *    asked at most once per call: no hedging (two providers are never called at once), no
 *    ping-pong and no loop.
 * 3. **No silent switching.** Every answer carries `AICallMeta` (provider, model, fallback,
 *    reason); the call log records both attempts; one structured log line is written per call.
 * 4. **A quota cooldown.** After a provider reports an exhausted quota, it is skipped for a
 *    short time, but only while a fallback that can serve the request exists. That stops one
 *    turn's later steps (and other users' requests) from spending a request on a provider that
 *    is known to refuse it. A Gemini-only deployment is unaffected.
 *
 * 5. **Live model data (optional).** A provider can be given a `DynamicCatalog` (OpenRouter's own
 *    model list). Then the model that answers is chosen from what the provider offers *now*: a
 *    configured model that was withdrawn is replaced by a compatible one, the provider is told the
 *    alternates to try inside the same request, and a model that answered 404 is not chosen again for a
 *    while. With no live data the declared catalog decides, exactly as before.
 *
 * Provider availability is evaluated per request from the credentials (`isConfigured()`), never
 * captured when the server starts.
 */
export type GatewayProviderId = CatalogProvider | "mock" | "none";

export interface GatewayProvider {
  id: GatewayProviderId;
  /** Upper-case name used in fallback reasons, e.g. GEMINI, OPENROUTER. */
  label: string;
  provider: AIProvider;
  /** True when credentials are present right now. */
  isConfigured(): boolean;
  /** A real network provider. False for the development mock and the fail-closed stub. */
  live: boolean;
  /** The provider's keys, when it has a rotator (ai/keyRotatingProvider.ts): reported in status and `/health`. */
  keys?: KeyRotator;
}

export interface ModelGatewayOptions {
  providers: GatewayProvider[];
  preferredPrimary: CatalogProvider;
  /** `null` = no fallback. Ignored when `preferredFallbacks` is given. */
  preferredFallback: CatalogProvider | null;
  /** The whole fallback chain, in order (empty = no fallback). Absent: `preferredFallback` alone. */
  preferredFallbacks?: CatalogProvider[];
  catalog: readonly ModelEntry[];
  /** 0 disables the cooldown. */
  quotaCooldownMs: number;
  /** Live model data per provider (OpenRouter only today). Absent = the declared catalog decides. */
  dynamic?: Partial<Record<CatalogProvider, DynamicCatalog>>;
  now?: () => number;
}

type Purpose = "planner" | "generation" | "vision";

interface Candidate {
  reg: GatewayProvider;
  entry: ModelEntry;
  /** Models the provider may try, in order, if `entry` fails inside the same request (live data only). */
  alternates?: ModelEntry[];
}

interface Pick {
  entry: ModelEntry | undefined;
  alternates: ModelEntry[];
  missing: string[];
}

/**
 * One step of the chain: a provider with the model chosen for it, or ("late") a provider whose declared models
 * cannot serve the request but whose live model list may know one. A late step is resolved only when it is
 * reached, so a request the first provider answers never costs a model-list fetch.
 */
type Step = { kind: "candidate"; candidate: Candidate } | { kind: "late"; reg: GatewayProvider };

type Plan =
  | { kind: "offline"; reg: GatewayProvider | undefined }
  | {
      kind: "route";
      /** The providers to try, in order. The first is always a candidate. */
      steps: Step[];
      /** Set when the first step is already a fallback because the primary was skipped. */
      skippedPrimary?: { reg: GatewayProvider; reason: FallbackReasonCode; error?: AIProviderError };
    }
  | { kind: "unsupported"; detail: string };

interface LogicalCall {
  modelCallId: string;
  purpose: Purpose;
  startedAt: number;
  records: ModelCallRecord[];
  failures: AttemptSummary[];
  attempts: number;
}

type AttemptResult<T> =
  | { ok: true; value: T; meta: AICallMeta }
  | { ok: false; error: unknown; provider: AIProviderError | undefined };

interface Operation<T> {
  purpose: Purpose;
  needs: Requirements;
  signal?: AbortSignal;
  /** Requested model parameters carried to the chosen provider. */
  temperature?: number;
  maxTokens?: number;
  modelCallId?: string;
  /** Runs the call on one provider with the model chosen for it. */
  invoke(provider: AIProvider, modelConfig: ModelConfiguration, modelCallId: string): Promise<T>;
  /** Extra check that the adapter (not just the catalog) can do the work. */
  adapterCan?(provider: AIProvider): boolean;
  attach(value: T, meta: AICallMeta): T;
}

/** What the development mock can do. It is never a fallback and never used with a live provider. */
const MOCK_CAPABILITIES = new Set(["text", "streaming", "tools"]);

interface Cooldown {
  until: number;
  error: AIProviderError;
}

export interface GatewayStatus {
  preferred: { primary: CatalogProvider; fallback: CatalogProvider | null; fallbacks: CatalogProvider[] };
  effective: {
    mode: "live" | "development_mock" | "unavailable";
    primary: GatewayProviderId | null;
    /** The first fallback (kept for older readers); `fallbacks` is the whole chain after the primary. */
    fallback: CatalogProvider | null;
    fallbacks: CatalogProvider[];
  };
  providers: Array<{
    id: GatewayProviderId;
    configured: boolean;
    live: boolean;
    models: ReturnType<typeof describeEntry>[];
    quotaCooldownUntil?: string;
    /** The provider answered 401/403: its credential is not accepted (cleared by the next success). */
    authRejected?: boolean;
    /** Each key's state by slot (never a key): which one requests start with, which are resting and why. */
    keys?: KeyRotatorStatus;
    /** Live model data, when the provider has it. */
    liveModels?: { loaded: boolean; fresh: boolean; models: number; freeModelsWithTools: number; source?: "account" | "public" };
  }>;
  counters: {
    calls: number;
    succeeded: number;
    failed: number;
    fallbacks: number;
    cooldownSkips: number;
    failuresByKind: Record<string, number>;
  };
}

export class ModelGateway implements AIProvider {
  readonly id = "gateway";

  private readonly registrations = new Map<GatewayProviderId, GatewayProvider>();
  private readonly cooldowns = new Map<GatewayProviderId, Cooldown>();
  private readonly authRejections = new Set<GatewayProviderId>();
  private readonly counters = { calls: 0, succeeded: 0, failed: 0, fallbacks: 0, cooldownSkips: 0, failuresByKind: {} as Record<string, number> };
  private readonly now: () => number;
  /** The configured order: the primary, then each fallback. */
  private readonly order: CatalogProvider[];

  constructor(private readonly options: ModelGatewayOptions) {
    for (const registration of options.providers) this.registrations.set(registration.id, registration);
    this.now = options.now ?? Date.now;
    const fallbacks = options.preferredFallbacks ?? (options.preferredFallback ? [options.preferredFallback] : []);
    this.order = [options.preferredPrimary, ...fallbacks].filter((id, index, all) => all.indexOf(id) === index);
  }

  // ---- the named API ----------------------------------------------------------------------------

  /** Plain text generation. Tools are refused here: a tool-using request is generateWithTools. */
  generateText(request: Omit<AIRequest, "tools">): Promise<AIResponse> {
    return this.generate(request as AIRequest);
  }

  /** Generation that may call tools. The model must declare tool support. */
  generateWithTools(request: AIRequest & { tools: ToolDefinition[] }): Promise<AIResponse> {
    if (request.tools.length === 0) throw new Error("generateWithTools requires at least one tool");
    return this.generate(request);
  }

  /** Incremental text. A model that cannot stream, or a request with tools, is not served. */
  streamText(request: Omit<AIRequest, "tools">): AsyncIterable<AIResponseChunk> {
    return this.streamGenerate(request as AIRequest);
  }

  async analyzeImage(input: { data: Buffer; mimeType: string; signal?: AbortSignal; trace?: ProviderTrace }): Promise<ImageAnalysisResult> {
    const request: AIRequest = {
      systemPrompt: IMAGE_ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: IMAGE_ANALYSIS_USER_PROMPT }],
      modelConfig: { provider: this.id, model: "", maxTokens: IMAGE_ANALYSIS_MAX_OUTPUT_TOKENS },
    };
    const operation: Operation<ImageAnalysisResult> = {
      purpose: "vision",
      needs: requirementsFor(request, { image: { mimeType: input.mimeType } }),
      signal: input.signal,
      maxTokens: IMAGE_ANALYSIS_MAX_OUTPUT_TOKENS,
      adapterCan: (provider) => typeof provider.analyzeImage === "function",
      invoke: (provider, modelConfig, modelCallId) =>
        provider.analyzeImage!({ data: input.data, mimeType: input.mimeType, modelConfig, signal: input.signal, trace: input.trace, modelCallId }),
      attach: (value, meta) => ({ ...value, meta }),
    };
    return this.run(operation);
  }

  /** True when some configured provider has a vision model that accepts this image type. */
  canAnalyzeImage(mimeType: string): boolean {
    const request: AIRequest = { systemPrompt: "", messages: [], modelConfig: { provider: this.id, model: "" } };
    const needs = requirementsFor(request, { image: { mimeType } });
    return this.chain().some((reg) => typeof reg.provider.analyzeImage === "function" && this.pick(reg, needs).entry !== undefined);
  }

  // ---- AIProvider ---------------------------------------------------------------------------------

  generate(request: AIRequest): Promise<AIResponse> {
    const operation: Operation<AIResponse> = {
      purpose: request.purpose ?? "planner",
      needs: requirementsFor(request),
      signal: request.signal,
      temperature: request.modelConfig.temperature,
      maxTokens: request.modelConfig.maxTokens,
      modelCallId: request.modelCallId,
      invoke: (provider, modelConfig, modelCallId) => provider.generate({ ...request, modelCallId, modelConfig }),
      attach: (value, meta) => ({ ...value, meta }),
    };
    return this.run(operation);
  }

  async *streamGenerate(request: AIRequest): AsyncIterable<AIResponseChunk> {
    if (request.tools && request.tools.length > 0) {
      // The stream carries text only; accepting tools would silently lose the calls.
      throw capabilityError("a streamed request cannot carry tools");
    }
    const purpose: Purpose = request.purpose ?? "planner";
    const needs = requirementsFor(request, { streaming: true });
    const call = this.beginCall(purpose, request.modelCallId);
    await this.warm();
    let plan = this.plan(needs);
    if (plan.kind === "unsupported" && (await this.refreshStale())) plan = this.plan(needs);
    if (plan.kind === "unsupported") throw this.reject(call, plan.detail);
    if (plan.kind === "offline") {
      yield* this.streamOffline(plan.reg, request, call);
      return;
    }

    const tried = new Set<GatewayProviderId>();
    const pending = [...plan.steps];
    let fallback = plan.skippedPrimary !== undefined;
    let reason: FallbackReasonCode | undefined = plan.skippedPrimary?.reason;
    let firstFailure: AIProviderError | undefined = plan.skippedPrimary?.error;
    let previous: { candidate: Candidate; error: AIProviderError } | undefined;

    for (let next = await this.nextCandidate(pending, tried, needs); next; next = await this.nextCandidate(pending, tried, needs)) {
      if (request.signal?.aborted) throw abortError();
      const candidate = await this.settle(next, needs);
      const { reg, entry } = candidate;
      tried.add(reg.id);
      call.attempts += 1;
      if (previous) this.noteFallback(call, previous.candidate, previous.error, candidate, reason!);
      const scope: AttemptContext = { provider: reg.id, fallback, fallbackReason: reason, records: [] };
      const started = this.now();
      const modelConfig = this.modelConfigFor(candidate, request.modelConfig.temperature, request.modelConfig.maxTokens);
      const iterator = reg.provider.streamGenerate({ ...request, modelCallId: call.modelCallId, modelConfig })[Symbol.asyncIterator]();
      let emitted = false;
      try {
        while (true) {
          // Each pull runs inside the attempt scope so the provider's call records are tagged.
          const pulled = await withAttemptContext(scope, () => iterator.next());
          if (pulled.done) break;
          const chunk = pulled.value;
          if (chunk.done) {
            this.finishAttempt(call, scope, started, reg);
            const meta = this.metaFor(call, reg, entry, scope, fallback, reason);
            this.succeed(call, meta);
            yield { ...chunk, meta };
            return;
          }
          if (chunk.delta) emitted = true;
          yield chunk;
        }
        // The provider's stream ended without its final chunk: still a completed call.
        this.finishAttempt(call, scope, started, reg);
        const meta = this.metaFor(call, reg, entry, scope, fallback, reason);
        this.succeed(call, meta);
        yield { delta: "", done: true, meta };
        return;
      } catch (error) {
        this.finishAttempt(call, scope, started, reg);
        if (isAbortError(error)) throw error;
        const failure = this.normalize(error, reg, entry);
        if (!failure) throw this.internal(call, error);
        this.recordFailure(call, candidate, failure);
        firstFailure ??= failure;
        // Once text has been delivered the answer cannot be restarted elsewhere: never mix two models.
        if (emitted || !this.canMoveOn(failure, fallback)) throw this.fail(call, firstFailure, failure);
        previous = { candidate, error: failure };
        reason = fallbackReasonFor(reg.label, failure.kind);
        fallback = true;
      } finally {
        // Also runs when the consumer stops early: close the provider stream so it cancels upstream.
        await iterator.return?.().catch(() => {});
      }
    }
    throw this.fail(call, firstFailure, previous!.error);
  }

  // ---- status -------------------------------------------------------------------------------------

  /**
   * The providers that can be asked right now, in the configured order: those with credentials present. A
   * preferred primary without credentials is left out, so the next provider in the chain answers first.
   */
  private chain(): GatewayProvider[] {
    return this.order.flatMap((id) => {
      const reg = this.registrations.get(id);
      return reg && reg.live && reg.isConfigured() ? [reg] : [];
    });
  }

  /** Effective providers right now, from the credentials present. */
  private effective(): { primary?: GatewayProvider; fallbacks: GatewayProvider[] } {
    const [primary, ...fallbacks] = this.chain();
    return { primary, fallbacks };
  }

  /** True when at least one real provider is configured. */
  hasLiveProvider(): boolean {
    return this.effective().primary !== undefined;
  }

  /**
   * What `/health` may say: the provider that answers by default, whether a fallback is active,
   * and (only then) whether the fallback's model declares tool support, which every chat turn's
   * planner step needs. Names no model, URL or key.
   */
  healthSummary(): { provider: string; fallback: boolean; fallbackTools?: boolean; authRejected?: string[] } {
    const { primary, fallbacks } = this.effective();
    if (primary) {
      const rejected = [primary, ...fallbacks].filter((reg) => this.isAuthRejected(reg.id)).map((reg) => reg.id);
      return {
        provider: primary.id,
        fallback: fallbacks.length > 0,
        // True when some fallback in the chain can take a tool-using chat turn.
        ...(fallbacks.length > 0 ? { fallbackTools: fallbacks.some((reg) => this.canUseTools(reg)) } : {}),
        // Only present when a provider refused its key: a normal /health is unchanged.
        ...(rejected.length > 0 ? { authRejected: rejected } : {}),
      };
    }
    const offline = this.offlineProvider();
    return { provider: offline?.id ?? "none", fallback: false };
  }

  /** True when an enabled model of this provider can take tool-using requests (declared, or offered live). */
  private canUseTools(reg: GatewayProvider): boolean {
    if (this.options.catalog.some((entry) => entry.provider === reg.id && entry.enabled && entry.capabilities.tools)) return true;
    const needs = requirementsFor({ systemPrompt: "", messages: [], modelConfig: { provider: "", model: "" }, tools: [{ name: "probe", description: "", inputSchema: { requiredFields: [] } }] });
    return this.pick(reg, needs).entry !== undefined;
  }

  /** The provider's key was refused, or (with several keys) one of its keys is refused right now even if another answered. */
  private isAuthRejected(id: GatewayProviderId): boolean {
    return (
      this.authRejections.has(id) ||
      (this.registrations.get(id)?.keys?.hasRejectedKey() ?? false) ||
      (this.options.dynamic?.[id as CatalogProvider]?.authRejected() ?? false)
    );
  }

  /** The default model for logging and the orchestrator's `modelConfig` (routing ignores it). */
  defaultModelConfig(): ModelConfiguration {
    const { primary } = this.effective();
    if (primary) {
      const entry = chooseEntry(this.options.catalog, primary.id as CatalogProvider, requirementsFor({ systemPrompt: "", messages: [], modelConfig: { provider: "", model: "" } }));
      return { provider: primary.id, model: entry.entry?.model ?? "unknown" };
    }
    const offline = this.offlineProvider();
    return offline?.id === "mock" ? { provider: "mock", model: "mock-v1" } : { provider: "none", model: "none" };
  }

  getProviderStatus(): GatewayStatus {
    const { primary, fallbacks } = this.effective();
    const offline = this.offlineProvider();
    const providers: GatewayStatus["providers"] = [...this.registrations.values()].map((reg) => {
      const cooldown = this.activeCooldown(reg.id);
      return {
        id: reg.id,
        configured: reg.isConfigured(),
        live: reg.live,
        models: this.options.catalog.filter((entry) => entry.provider === reg.id).map(describeEntry),
        ...(cooldown ? { quotaCooldownUntil: new Date(cooldown.until).toISOString() } : {}),
        ...(this.isAuthRejected(reg.id) ? { authRejected: true } : {}),
        ...(reg.keys ? { keys: reg.keys.status() } : {}),
        ...(this.options.dynamic?.[reg.id as CatalogProvider] ? { liveModels: this.options.dynamic[reg.id as CatalogProvider]!.status() } : {}),
      };
    });
    return {
      preferred: { primary: this.options.preferredPrimary, fallback: this.order[1] ?? null, fallbacks: this.order.slice(1) },
      effective: {
        mode: primary ? "live" : offline?.id === "mock" ? "development_mock" : "unavailable",
        primary: primary?.id ?? offline?.id ?? null,
        fallback: (fallbacks[0]?.id as CatalogProvider | undefined) ?? null,
        fallbacks: fallbacks.map((reg) => reg.id as CatalogProvider),
      },
      providers,
      counters: { ...this.counters, failuresByKind: { ...this.counters.failuresByKind } },
    };
  }

  // ---- routing ------------------------------------------------------------------------------------

  private offlineProvider(): GatewayProvider | undefined {
    return this.registrations.get("mock") ?? this.registrations.get("none");
  }

  private plan(needs: Requirements, adapterCan?: (provider: AIProvider) => boolean): Plan {
    const chain = this.chain();
    if (chain.length === 0) return { kind: "offline", reg: this.offlineProvider() };

    const steps: Step[] = [];
    const missing: string[] = [];
    let skippedPrimary: Extract<Plan, { kind: "route" }>["skippedPrimary"];
    chain.forEach((reg, index) => {
      const choice = this.pick(reg, needs, adapterCan);
      if (choice.entry) {
        steps.push({ kind: "candidate", candidate: { reg, entry: choice.entry, alternates: choice.alternates } });
        return;
      }
      missing.push(`${reg.id}: ${choice.missing.join("+") || "none"}`);
      // The primary cannot serve this request at all (a capability it does not declare).
      if (index === 0) skippedPrimary = { reg, reason: fallbackReasonFor(reg.label, "AI_PROVIDER_CAPABILITY_UNSUPPORTED") };
      if (this.options.dynamic?.[reg.id as CatalogProvider]) steps.push({ kind: "late", reg });
    });
    if (!steps.some((step) => step.kind === "candidate")) return { kind: "unsupported", detail: missing.join("; ") };

    // A provider whose quota was reported spent a moment ago is skipped while another one can serve the request.
    const cooled = (step: Step) => step.kind === "candidate" && this.activeCooldown(step.candidate.reg.id) !== undefined;
    let route = steps;
    if (steps.some((step) => step.kind === "candidate" && !cooled(step)) && steps.some(cooled)) {
      this.counters.cooldownSkips += 1;
      const head = steps[0]!;
      if (!skippedPrimary && head.kind === "candidate" && head.candidate.reg === chain[0] && cooled(head)) {
        skippedPrimary = { reg: head.candidate.reg, reason: cooldownReasonFor(head.candidate.reg.label), error: copyError(this.activeCooldown(head.candidate.reg.id)!.error) };
      }
      route = steps.filter((step) => !cooled(step));
    }
    // A late step cannot go first (it may find nothing): it waits until after the first candidate.
    const firstCandidate = route.findIndex((step) => step.kind === "candidate");
    route = [route[firstCandidate]!, ...route.slice(0, firstCandidate), ...route.slice(firstCandidate + 1)];
    return { kind: "route", steps: route, ...(skippedPrimary ? { skippedPrimary } : {}) };
  }

  /** The next provider to ask: the next step not yet tried, resolving a late step from its live list now. */
  private async nextCandidate(pending: Step[], tried: Set<GatewayProviderId>, needs: Requirements, adapterCan?: (provider: AIProvider) => boolean): Promise<Candidate | undefined> {
    while (pending.length > 0) {
      const step = pending.shift()!;
      const reg = step.kind === "candidate" ? step.candidate.reg : step.reg;
      if (tried.has(reg.id)) continue;
      if (step.kind === "candidate") return step.candidate;
      await this.options.dynamic?.[reg.id as CatalogProvider]?.refresh();
      const choice = this.pick(reg, needs, adapterCan);
      if (choice.entry) return { reg, entry: choice.entry, alternates: choice.alternates };
    }
    return undefined;
  }

  /**
   * Whether the next provider in the chain is asked after `error`. Before any fallback (`fallingBack` false) only
   * a condition another provider can answer starts the chain; a provider-side 404 counts (that model is not offered
   * to this account, another provider's is). Once falling back, a fallback's rejected key or missing model is that
   * provider's own problem and the chain moves on; a refused request or a bug never does.
   */
  private canMoveOn(error: AIProviderError, fallingBack: boolean): boolean {
    if (isFallbackEligibleKind(error.kind)) return true;
    const missingModel = error.kind === "AI_PROVIDER_CAPABILITY_UNSUPPORTED" && error.status === 404;
    if (missingModel) return true;
    return fallingBack && (error.kind === "AI_PROVIDER_AUTH_ERROR" || error.kind === "AI_PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  /**
   * The model for `reg` and, when live data is available, the alternates the provider may try inside
   * the same request. With live data the provider's current list decides; otherwise (or when it offers
   * nothing usable) the declared catalog does, exactly as without live data.
   */
  private pick(reg: GatewayProvider, needs: Requirements, adapterCan?: (provider: AIProvider) => boolean): Pick {
    if (adapterCan && !adapterCan(reg.provider)) return { entry: undefined, alternates: [], missing: ["adapter"] };
    const dynamic = this.options.dynamic?.[reg.id as CatalogProvider];
    if (dynamic?.hasData()) {
      const declared = this.options.catalog.filter((entry) => entry.provider === reg.id);
      const live = dynamic.select(needs, declared);
      if (live && live.models.length > 0) return { entry: live.models[0], alternates: live.models.slice(1), missing: [] };
    }
    const chosen = chooseEntry(this.options.catalog, reg.id as CatalogProvider, needs);
    return { entry: chosen.entry, alternates: [], missing: chosen.missing };
  }

  /** Brings the live data of the provider that is about to answer up to date (and of the fallback when the primary is being skipped). */
  private async warm(): Promise<void> {
    if (!this.options.dynamic) return;
    // The first provider that is not in a quota cooldown, and those skipped before it.
    const targets: GatewayProvider[] = [];
    for (const reg of this.chain()) {
      targets.push(reg);
      if (!this.activeCooldown(reg.id)) break;
    }
    await Promise.all(targets.map((reg) => this.options.dynamic![reg.id as CatalogProvider]?.refresh()));
  }

  /** Just before a provider is called: refresh its live data if it is stale and choose the model again from it. */
  private async settle(candidate: Candidate, needs: Requirements, adapterCan?: (provider: AIProvider) => boolean): Promise<Candidate> {
    const dynamic = this.options.dynamic?.[candidate.reg.id as CatalogProvider];
    if (!dynamic) return candidate;
    await dynamic.refresh();
    const choice = this.pick(candidate.reg, needs, adapterCan);
    return choice.entry ? { reg: candidate.reg, entry: choice.entry, alternates: choice.alternates } : candidate;
  }

  /** Refreshes the live data of every effective provider that has gone stale. True when any had. */
  private async refreshStale(): Promise<boolean> {
    const dynamic = this.options.dynamic;
    if (!dynamic) return false;
    const stale = this.chain().flatMap((reg) => {
      const catalog = dynamic[reg.id as CatalogProvider];
      return catalog && !catalog.isFresh() ? [catalog] : [];
    });
    await Promise.all(stale.map((catalog) => catalog.refresh()));
    return stale.length > 0;
  }

  private modelConfigFor(candidate: Candidate, temperature?: number, maxTokens?: number): ModelConfiguration {
    const alternates = candidate.alternates?.map((alternate) => alternate.model) ?? [];
    return {
      provider: candidate.reg.id,
      model: candidate.entry.model,
      temperature,
      maxTokens,
      ...(alternates.length > 0 ? { fallbackModels: alternates } : {}),
    };
  }

  // ---- one logical call -------------------------------------------------------------------------

  private async run<T>(operation: Operation<T>): Promise<T> {
    const call = this.beginCall(operation.purpose, operation.modelCallId);
    await this.warm();
    let plan = this.plan(operation.needs, operation.adapterCan);
    // The declared catalogs cannot serve this; a provider's live list may know a model that can.
    if (plan.kind === "unsupported" && (await this.refreshStale())) plan = this.plan(operation.needs, operation.adapterCan);
    if (plan.kind === "unsupported") throw this.reject(call, plan.detail);
    if (plan.kind === "offline") return this.runOffline(plan.reg, operation, call);

    const tried = new Set<GatewayProviderId>();
    const pending = [...plan.steps];
    let fallback = plan.skippedPrimary !== undefined;
    let reason: FallbackReasonCode | undefined = plan.skippedPrimary?.reason;
    // The condition the user is told about when every provider fails (see fail()).
    let firstFailure: AIProviderError | undefined = plan.skippedPrimary?.error;
    let previous: { candidate: Candidate; error: AIProviderError } | undefined;

    for (let next = await this.nextCandidate(pending, tried, operation.needs, operation.adapterCan); next; next = await this.nextCandidate(pending, tried, operation.needs, operation.adapterCan)) {
      tried.add(next.reg.id);
      if (previous) this.noteFallback(call, previous.candidate, previous.error, next, reason!);
      const result = await this.attempt(next, operation, call, fallback, reason);
      if (result.ok) return result.value;
      if (!result.provider) throw this.internal(call, result.error);
      firstFailure ??= result.provider;
      if (!this.canMoveOn(result.provider, fallback)) throw this.fail(call, firstFailure, result.provider);
      previous = { candidate: next, error: result.provider };
      reason = fallbackReasonFor(next.reg.label, result.provider.kind);
      fallback = true;
    }
    // Every provider in the chain was asked (or none was left to ask after the skipped primary).
    throw this.fail(call, firstFailure, previous!.error);
  }

  private async attempt<T>(
    candidate: Candidate,
    operation: Operation<T>,
    call: LogicalCall,
    fallback: boolean,
    reason: FallbackReasonCode | undefined,
  ): Promise<AttemptResult<T>> {
    if (operation.signal?.aborted) throw abortError();
    const settled = await this.settle(candidate, operation.needs, operation.adapterCan);
    const { reg, entry } = settled;
    call.attempts += 1;
    const scope: AttemptContext = { provider: reg.id, fallback, fallbackReason: reason, records: [] };
    const started = this.now();
    const modelConfig = this.modelConfigFor(settled, operation.temperature, operation.maxTokens);
    let value: T;
    try {
      value = await withAttemptContext(scope, () => operation.invoke(reg.provider, modelConfig, call.modelCallId));
    } catch (error) {
      this.finishAttempt(call, scope, started, reg);
      // A cancelled turn is not a provider failure: no fallback, nothing to count.
      if (isAbortError(error)) throw error;
      const failure = this.normalize(error, reg, entry);
      if (failure) this.recordFailure(call, settled, failure);
      return { ok: false, error, provider: failure };
    }
    this.finishAttempt(call, scope, started, reg);
    const meta = this.metaFor(call, reg, entry, scope, fallback, reason);
    this.succeed(call, meta);
    return { ok: true, value: operation.attach(value, meta), meta };
  }

  /** Turns a thrown error into an AIProviderError when it is a provider-side failure; otherwise undefined. */
  private normalize(error: unknown, reg: GatewayProvider, entry: ModelEntry): AIProviderError | undefined {
    if (error instanceof AIProviderError) {
      error.provider ??= reg.id;
      return error;
    }
    if (isTransportError(error)) return transportFailure(`${reg.label} request`, reg.id, error, entry.model);
    return undefined;
  }

  private finishAttempt(call: LogicalCall, scope: AttemptContext, started: number, _reg: GatewayProvider): void {
    const latencyMs = this.now() - started;
    for (const record of scope.records) {
      record.latencyMs = latencyMs;
      call.records.push(record);
    }
  }

  private metaFor(call: LogicalCall, reg: GatewayProvider, entry: ModelEntry, scope: AttemptContext, fallback: boolean, reason?: string): AICallMeta {
    const answered = [...scope.records].reverse().find((record) => record.outcome === "ok");
    return {
      provider: reg.id,
      model: answered?.servedModel ?? entry.model,
      configuredModel: entry.model,
      fallback,
      ...(fallback && reason ? { fallbackReason: reason } : {}),
      attempts: call.attempts,
      latencyMs: this.now() - call.startedAt,
      modelCallId: call.modelCallId,
    };
  }

  // ---- bookkeeping, errors and logs --------------------------------------------------------------

  private beginCall(purpose: Purpose, modelCallId?: string): LogicalCall {
    this.counters.calls += 1;
    return { modelCallId: modelCallId ?? randomUUID(), purpose, startedAt: this.now(), records: [], failures: [], attempts: 0 };
  }

  private activeCooldown(id: GatewayProviderId): Cooldown | undefined {
    const cooldown = this.cooldowns.get(id);
    if (!cooldown) return undefined;
    if (cooldown.until <= this.now()) {
      this.cooldowns.delete(id);
      return undefined;
    }
    return cooldown;
  }

  private recordFailure(call: LogicalCall, candidate: Candidate, error: AIProviderError): void {
    const { reg, entry } = candidate;
    call.failures.push({ provider: reg.id, model: entry.model, kind: error.kind, status: error.status || undefined });
    this.counters.failuresByKind[error.kind] = (this.counters.failuresByKind[error.kind] ?? 0) + 1;
    if (error.kind === "AI_PROVIDER_AUTH_ERROR") this.authRejections.add(reg.id);
    // A 404 means the provider has no endpoint for the model(s) in this request: do not choose them again for a while.
    const dynamic = this.options.dynamic?.[reg.id as CatalogProvider];
    if (dynamic) for (const model of [entry, ...(candidate.alternates ?? [])]) dynamic.noteFailure(model.model, error);
    // A quota that is spent does not recover in minutes: remember it, so later calls go straight to
    // a fallback that can serve them (see plan()).
    if (error.kind === "AI_PROVIDER_QUOTA_EXCEEDED" && this.options.quotaCooldownMs > 0) {
      this.cooldowns.set(reg.id, { until: this.now() + this.options.quotaCooldownMs, error });
    }
  }

  private succeed(call: LogicalCall, meta: AICallMeta): void {
    // The provider answered: whatever cooldown it was under is over, and its credential is evidently accepted.
    this.cooldowns.delete(meta.provider as GatewayProviderId);
    this.authRejections.delete(meta.provider as GatewayProviderId);
    this.options.dynamic?.[meta.provider as CatalogProvider]?.noteSuccess();
    this.counters.succeeded += 1;
    if (meta.fallback) this.counters.fallbacks += 1;
    this.logCall(call, "success", meta, undefined);
  }

  private noteFallback(call: LogicalCall, from: Candidate, error: AIProviderError, to: Candidate, reason: string): void {
    logger.warn("AI provider fallback", {
      ...correlationFields(),
      modelCallId: call.modelCallId,
      purpose: call.purpose,
      fallbackReason: reason,
      from: { provider: from.reg.id, model: from.entry.model, kind: error.kind, status: error.status || undefined },
      to: { provider: to.reg.id, model: to.entry.model },
    });
  }

  /** Builds the error to throw after every allowed attempt failed, and logs the call. */
  private fail(call: LogicalCall, primary: AIProviderError | undefined, last: AIProviderError): AIProviderError {
    // The last provider asked is the final state of the system, unless its failure is about our own
    // configuration (a bad key, an unsupported request): then the primary's availability problem is
    // the truer answer for the user.
    const chosen = primary && primary !== last && !isFallbackEligibleKind(last.kind) ? primary : last;
    chosen.attempts = [...call.failures];
    this.counters.failed += 1;
    this.logCall(call, "failed", undefined, chosen);
    return chosen;
  }

  private reject(call: LogicalCall, detail: string): AIProviderError {
    const error = capabilityError(detail);
    error.attempts = [];
    this.counters.failed += 1;
    this.counters.failuresByKind[error.kind] = (this.counters.failuresByKind[error.kind] ?? 0) + 1;
    this.logCall(call, "failed", undefined, error);
    return error;
  }

  /** An application error (not a provider failure) is rethrown untouched; it must not look like an outage. */
  private internal(call: LogicalCall, error: unknown): unknown {
    this.counters.failed += 1;
    this.counters.failuresByKind["AI_INTERNAL_ERROR"] = (this.counters.failuresByKind["AI_INTERNAL_ERROR"] ?? 0) + 1;
    logger.error("AI call failed with an internal error", {
      ...correlationFields(),
      modelCallId: call.modelCallId,
      purpose: call.purpose,
      errorKind: "AI_INTERNAL_ERROR",
      error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
    });
    return error;
  }

  private logCall(call: LogicalCall, finalStatus: "success" | "failed", meta: AICallMeta | undefined, error: AIProviderError | undefined): void {
    const records = call.records;
    const providerHttpRequests = records.reduce((sum, record) => sum + record.httpRequests, 0);
    const retryCount = records.reduce((sum, record) => sum + Math.max(0, record.httpRequests - 1), 0);
    const promptTokens = records.reduce((sum, record) => sum + (record.promptTokens ?? 0), 0);
    const completionTokens = records.reduce((sum, record) => sum + (record.completionTokens ?? 0), 0);
    const costRecords = records.filter((record) => record.costUsd !== undefined);
    const costUsd = costRecords.reduce((sum, record) => sum + record.costUsd!, 0);
    const fields = {
      ...correlationFields(),
      modelCallId: call.modelCallId,
      purpose: call.purpose,
      finalStatus,
      provider: meta?.provider ?? error?.provider,
      model: meta?.model,
      fallback: meta?.fallback ?? (call.failures.length > 0 && call.attempts > 1),
      fallbackReason: meta?.fallbackReason,
      latencyMs: this.now() - call.startedAt,
      providerHttpRequests,
      retryCount,
      // Named "usage", not "...Tokens": the log redactor hides any field whose name contains "token".
      ...(promptTokens + completionTokens > 0 ? { usage: { prompt: promptTokens, completion: completionTokens } } : {}),
      // What the provider billed, when it says (OpenRouter reports `usage.cost`).
      ...(costRecords.length > 0 ? { costUsd: Number(costUsd.toFixed(8)) } : {}),
      attempts: records.map((record) => ({
        provider: record.provider,
        model: record.servedModel ?? record.configuredModel,
        outcome: record.outcome,
        status: record.status,
        httpRequests: record.httpRequests,
        latencyMs: record.latencyMs,
        fallback: record.fallback,
        // Which key, when the provider has several: a rotation shows as two attempts of one provider.
        ...(record.keySlot !== undefined ? { keySlot: record.keySlot } : {}),
      })),
      ...(error
        ? {
            errorKind: error.kind,
            errorStatus: error.status || undefined,
            quotaType: error.quotaType,
            // The provider's own explanation, already key-scrubbed and bounded: a 404 "0 endpoints ... ZDR violation (account
            // settings)" names the OpenRouter setting to change, and the kind and status alone do not.
            errorDetail: error.message.slice(0, 400),
            failedAttempts: error.attempts,
          }
        : {}),
    };
    if (finalStatus === "success") logger.info("AI call", fields);
    else logger.warn("AI call failed", fields);
  }

  // ---- development mock and fail-closed stub ----------------------------------------------------

  private async runOffline<T>(reg: GatewayProvider | undefined, operation: Operation<T>, call: LogicalCall): Promise<T> {
    if (!reg) {
      throw this.fail(call, undefined, new AIProviderError("No AI provider is configured", "AI_UNAVAILABLE", 503, false));
    }
    if (reg.id === "mock") {
      for (const capability of operation.needs.capabilities) {
        if (!MOCK_CAPABILITIES.has(capability)) throw this.reject(call, `mock: ${capability}`);
      }
      if (operation.adapterCan && !operation.adapterCan(reg.provider)) throw this.reject(call, "mock: adapter");
    }
    call.attempts += 1;
    const scope: AttemptContext = { provider: reg.id, fallback: false, records: [] };
    const started = this.now();
    const modelConfig: ModelConfiguration = { provider: reg.id, model: reg.id === "mock" ? "mock-v1" : "none", temperature: operation.temperature, maxTokens: operation.maxTokens };
    try {
      const value = await withAttemptContext(scope, () => operation.invoke(reg.provider, modelConfig, call.modelCallId));
      this.finishAttempt(call, scope, started, reg);
      const meta: AICallMeta = {
        provider: reg.id,
        model: modelConfig.model,
        configuredModel: modelConfig.model,
        fallback: false,
        attempts: call.attempts,
        latencyMs: this.now() - call.startedAt,
        modelCallId: call.modelCallId,
      };
      this.counters.succeeded += 1;
      this.logCall(call, "success", meta, undefined);
      return operation.attach(value, meta);
    } catch (error) {
      this.finishAttempt(call, scope, started, reg);
      if (isAbortError(error)) throw error;
      if (error instanceof AIProviderError) {
        error.provider ??= reg.id;
        throw this.fail(call, undefined, error);
      }
      throw this.internal(call, error);
    }
  }

  private async *streamOffline(reg: GatewayProvider | undefined, request: AIRequest, call: LogicalCall): AsyncIterable<AIResponseChunk> {
    if (!reg) throw this.fail(call, undefined, new AIProviderError("No AI provider is configured", "AI_UNAVAILABLE", 503, false));
    call.attempts += 1;
    const modelConfig: ModelConfiguration = { provider: reg.id, model: reg.id === "mock" ? "mock-v1" : "none" };
    try {
      for await (const chunk of reg.provider.streamGenerate({ ...request, modelCallId: call.modelCallId, modelConfig })) yield chunk;
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (error instanceof AIProviderError) {
        error.provider ??= reg.id;
        throw this.fail(call, undefined, error);
      }
      throw this.internal(call, error);
    }
    this.counters.succeeded += 1;
  }
}

/** A fresh error for each caller: the cooldown's own instance is shared and carries per-call fields. */
function copyError(error: AIProviderError): AIProviderError {
  return new AIProviderError(error.message, error.code, error.status, error.retryable, error.retryAfterMs, error.quotaType, error.evidence, {
    kind: error.kind,
    provider: error.provider,
  });
}

function capabilityError(detail: string): AIProviderError {
  return new AIProviderError(`No configured AI model can serve this request (${detail})`, "AI_UNAVAILABLE", 503, false, undefined, undefined, {}, {
    kind: "AI_PROVIDER_CAPABILITY_UNSUPPORTED",
  });
}
