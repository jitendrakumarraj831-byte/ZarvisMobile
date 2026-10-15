import { randomUUID } from "node:crypto";
import { correlationFields } from "../observability/requestContext.js";
import { logger } from "../security/redact.js";
import { requirementsFor, type Requirements } from "./capabilities.js";
import { withAttemptContext, type AttemptContext, type ModelCallRecord } from "./callTrace.js";
import { cooldownReasonFor, fallbackReasonFor, isFallbackEligibleKind, type AttemptSummary, type FallbackReasonCode } from "./errorTaxonomy.js";
import { AIProviderError, abortError } from "./geminiErrors.js";
import { IMAGE_ANALYSIS_MAX_OUTPUT_TOKENS, IMAGE_ANALYSIS_SYSTEM_PROMPT, IMAGE_ANALYSIS_USER_PROMPT } from "./imageAnalysisPrompts.js";
import { chooseEntry, describeEntry, type CatalogProvider, type ModelEntry } from "./modelCatalog.js";
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
 * 2. **One controlled fallback.** If the primary fails with a provider-side, temporary condition
 *    (rate limit, exhausted quota, unavailable, timeout) and a configured fallback can serve the
 *    same request, it makes exactly ONE more attempt there. Authentication errors, invalid
 *    requests, capability gaps and internal errors never fall back, so a real bug or a revoked
 *    key is not hidden behind another provider. There is no hedging (the two providers are never
 *    called at once), no ping-pong and no loop.
 * 3. **No silent switching.** Every answer carries `AICallMeta` (provider, model, fallback,
 *    reason); the call log records both attempts; one structured log line is written per call.
 * 4. **A quota cooldown.** After a provider reports an exhausted quota, it is skipped for a
 *    short time, but only while a fallback that can serve the request exists. That stops one
 *    turn's later steps (and other users' requests) from spending a request on a provider that
 *    is known to refuse it. A Gemini-only deployment is unaffected.
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
}

export interface ModelGatewayOptions {
  providers: GatewayProvider[];
  preferredPrimary: CatalogProvider;
  /** `null` = no fallback. */
  preferredFallback: CatalogProvider | null;
  catalog: readonly ModelEntry[];
  /** 0 disables the cooldown. */
  quotaCooldownMs: number;
  now?: () => number;
}

type Purpose = "planner" | "generation" | "vision";

interface Candidate {
  reg: GatewayProvider;
  entry: ModelEntry;
}

type Plan =
  | { kind: "offline"; reg: GatewayProvider | undefined }
  | {
      kind: "route";
      first: Candidate;
      /** The one fallback attempt, only when `first` is the primary. */
      second?: Candidate;
      /** Set when `first` is already the fallback because the primary was skipped. */
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
  preferred: { primary: CatalogProvider; fallback: CatalogProvider | null };
  effective: {
    mode: "live" | "development_mock" | "unavailable";
    primary: GatewayProviderId | null;
    fallback: CatalogProvider | null;
  };
  providers: Array<{
    id: GatewayProviderId;
    configured: boolean;
    live: boolean;
    models: ReturnType<typeof describeEntry>[];
    quotaCooldownUntil?: string;
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
  private readonly counters = { calls: 0, succeeded: 0, failed: 0, fallbacks: 0, cooldownSkips: 0, failuresByKind: {} as Record<string, number> };
  private readonly now: () => number;

  constructor(private readonly options: ModelGatewayOptions) {
    for (const registration of options.providers) this.registrations.set(registration.id, registration);
    this.now = options.now ?? Date.now;
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
    const { primary, fallback } = this.effective();
    return [primary, fallback].some((reg) => {
      if (!reg || typeof reg.provider.analyzeImage !== "function") return false;
      return chooseEntry(this.options.catalog, reg.id as CatalogProvider, needs).entry !== undefined;
    });
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
    const plan = this.plan(needs);
    if (plan.kind === "unsupported") throw this.reject(call, plan.detail);
    if (plan.kind === "offline") {
      yield* this.streamOffline(plan.reg, request, call);
      return;
    }

    const attempts: Array<{ candidate: Candidate; fallback: boolean; reason?: FallbackReasonCode }> = [
      { candidate: plan.first, fallback: plan.skippedPrimary !== undefined, reason: plan.skippedPrimary?.reason },
    ];
    if (plan.second) attempts.push({ candidate: plan.second, fallback: true });
    let primaryError: AIProviderError | undefined = plan.skippedPrimary?.error;

    for (let index = 0; index < attempts.length; index += 1) {
      const step = attempts[index]!;
      const { reg, entry } = step.candidate;
      let reason = step.reason;
      if (index === 1) reason = fallbackReasonFor(plan.first.reg.label, primaryError!.kind);
      if (request.signal?.aborted) throw abortError();
      call.attempts += 1;
      if (index === 1) this.noteFallback(call, plan.first, primaryError!, step.candidate, reason!);
      const scope: AttemptContext = { provider: reg.id, fallback: step.fallback, fallbackReason: reason, records: [] };
      const started = this.now();
      const modelConfig: ModelConfiguration = { provider: reg.id, model: entry.model, temperature: request.modelConfig.temperature, maxTokens: request.modelConfig.maxTokens };
      const iterator = reg.provider.streamGenerate({ ...request, modelCallId: call.modelCallId, modelConfig })[Symbol.asyncIterator]();
      let emitted = false;
      try {
        while (true) {
          // Each pull runs inside the attempt scope so the provider's call records are tagged.
          const next = await withAttemptContext(scope, () => iterator.next());
          if (next.done) break;
          const chunk = next.value;
          if (chunk.done) {
            this.finishAttempt(call, scope, started, reg);
            const meta = this.metaFor(call, reg, entry, scope, step.fallback, reason);
            this.succeed(call, meta);
            yield { ...chunk, meta };
            return;
          }
          if (chunk.delta) emitted = true;
          yield chunk;
        }
        // The provider's stream ended without its final chunk: still a completed call.
        this.finishAttempt(call, scope, started, reg);
        const meta = this.metaFor(call, reg, entry, scope, step.fallback, reason);
        this.succeed(call, meta);
        yield { delta: "", done: true, meta };
        return;
      } catch (error) {
        this.finishAttempt(call, scope, started, reg);
        if (isAbortError(error)) throw error;
        const failure = this.normalize(error, reg, entry);
        if (!failure) throw this.internal(call, error);
        this.recordFailure(call, reg, entry, failure);
        // Once text has been delivered the answer cannot be restarted elsewhere: never mix two models.
        const canFallBack = index === 0 && attempts.length > 1 && !emitted && isFallbackEligibleKind(failure.kind);
        if (canFallBack) {
          primaryError = failure;
          continue;
        }
        throw this.fail(call, primaryError, failure);
      } finally {
        // Also runs when the consumer stops early: close the provider stream so it cancels upstream.
        await iterator.return?.().catch(() => {});
      }
    }
  }

  // ---- status -------------------------------------------------------------------------------------

  /** Effective providers right now, from the credentials present. */
  private effective(): { primary?: GatewayProvider; fallback?: GatewayProvider } {
    const { preferredPrimary, preferredFallback } = this.options;
    const usable = (id: CatalogProvider | null): GatewayProvider | undefined => {
      const reg = id ? this.registrations.get(id) : undefined;
      return reg && reg.live && reg.isConfigured() ? reg : undefined;
    };
    const primary = usable(preferredPrimary);
    if (primary) {
      const fallback = usable(preferredFallback);
      return { primary, fallback: fallback && fallback.id !== primary.id ? fallback : undefined };
    }
    // The preferred primary has no credentials: the other provider answers, with no fallback.
    return { primary: usable(preferredFallback) };
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
  healthSummary(): { provider: string; fallback: boolean; fallbackTools?: boolean } {
    const { primary, fallback } = this.effective();
    if (primary) {
      return {
        provider: primary.id,
        fallback: fallback !== undefined,
        ...(fallback ? { fallbackTools: this.declaresTools(fallback) } : {}),
      };
    }
    const offline = this.offlineProvider();
    return { provider: offline?.id ?? "none", fallback: false };
  }

  /** True when an enabled catalog model of this provider declares tool support. */
  private declaresTools(reg: GatewayProvider): boolean {
    return this.options.catalog.some((entry) => entry.provider === reg.id && entry.enabled && entry.capabilities.tools);
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
    const { primary, fallback } = this.effective();
    const offline = this.offlineProvider();
    const providers: GatewayStatus["providers"] = [...this.registrations.values()].map((reg) => {
      const cooldown = this.activeCooldown(reg.id);
      return {
        id: reg.id,
        configured: reg.isConfigured(),
        live: reg.live,
        models: this.options.catalog.filter((entry) => entry.provider === reg.id).map(describeEntry),
        ...(cooldown ? { quotaCooldownUntil: new Date(cooldown.until).toISOString() } : {}),
      };
    });
    return {
      preferred: { primary: this.options.preferredPrimary, fallback: this.options.preferredFallback },
      effective: {
        mode: primary ? "live" : offline?.id === "mock" ? "development_mock" : "unavailable",
        primary: primary?.id ?? offline?.id ?? null,
        fallback: (fallback?.id as CatalogProvider | undefined) ?? null,
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
    const { primary, fallback } = this.effective();
    if (!primary) return { kind: "offline", reg: this.offlineProvider() };

    const choose = (reg: GatewayProvider | undefined) => {
      if (!reg) return undefined;
      if (adapterCan && !adapterCan(reg.provider)) return { entry: undefined, missing: ["adapter"] };
      return chooseEntry(this.options.catalog, reg.id as CatalogProvider, needs);
    };
    const primaryChoice = choose(primary)!;
    const fallbackChoice = choose(fallback);
    const fallbackCandidate: Candidate | undefined = fallback && fallbackChoice?.entry ? { reg: fallback, entry: fallbackChoice.entry } : undefined;

    if (!primaryChoice.entry) {
      // The primary cannot serve this request at all (a capability it does not declare).
      if (fallbackCandidate) {
        return { kind: "route", first: fallbackCandidate, skippedPrimary: { reg: primary, reason: fallbackReasonFor(primary.label, "AI_PROVIDER_CAPABILITY_UNSUPPORTED") } };
      }
      const parts = [`${primary.id}: ${primaryChoice.missing.join("+") || "none"}`];
      if (fallback && fallbackChoice) parts.push(`${fallback.id}: ${fallbackChoice.missing.join("+") || "none"}`);
      return { kind: "unsupported", detail: parts.join("; ") };
    }

    const primaryCandidate: Candidate = { reg: primary, entry: primaryChoice.entry };
    const cooled = this.activeCooldown(primary.id);
    if (cooled && fallbackCandidate) {
      this.counters.cooldownSkips += 1;
      return { kind: "route", first: fallbackCandidate, skippedPrimary: { reg: primary, reason: cooldownReasonFor(primary.label), error: copyError(cooled.error) } };
    }
    return { kind: "route", first: primaryCandidate, second: fallbackCandidate };
  }

  // ---- one logical call -------------------------------------------------------------------------

  private async run<T>(operation: Operation<T>): Promise<T> {
    const call = this.beginCall(operation.purpose, operation.modelCallId);
    const plan = this.plan(operation.needs, operation.adapterCan);
    if (plan.kind === "unsupported") throw this.reject(call, plan.detail);
    if (plan.kind === "offline") return this.runOffline(plan.reg, operation, call);

    const skipped = plan.skippedPrimary;
    const first = await this.attempt(plan.first, operation, call, skipped !== undefined, skipped?.reason);
    if (first.ok) return first.value;
    if (!first.provider) throw this.internal(call, first.error);
    const primaryFailure = skipped?.error ?? (skipped ? undefined : first.provider);

    if (skipped || !plan.second || !isFallbackEligibleKind(first.provider.kind)) {
      throw this.fail(call, skipped?.error, first.provider);
    }

    const reason = fallbackReasonFor(plan.first.reg.label, first.provider.kind);
    this.noteFallback(call, plan.first, first.provider, plan.second, reason);
    const second = await this.attempt(plan.second, operation, call, true, reason);
    if (second.ok) return second.value;
    if (!second.provider) throw this.internal(call, second.error);
    throw this.fail(call, primaryFailure, second.provider);
  }

  private async attempt<T>(
    candidate: Candidate,
    operation: Operation<T>,
    call: LogicalCall,
    fallback: boolean,
    reason: FallbackReasonCode | undefined,
  ): Promise<AttemptResult<T>> {
    const { reg, entry } = candidate;
    if (operation.signal?.aborted) throw abortError();
    call.attempts += 1;
    const scope: AttemptContext = { provider: reg.id, fallback, fallbackReason: reason, records: [] };
    const started = this.now();
    const modelConfig: ModelConfiguration = { provider: reg.id, model: entry.model, temperature: operation.temperature, maxTokens: operation.maxTokens };
    let value: T;
    try {
      value = await withAttemptContext(scope, () => operation.invoke(reg.provider, modelConfig, call.modelCallId));
    } catch (error) {
      this.finishAttempt(call, scope, started, reg);
      // A cancelled turn is not a provider failure: no fallback, nothing to count.
      if (isAbortError(error)) throw error;
      const failure = this.normalize(error, reg, entry);
      if (failure) this.recordFailure(call, reg, entry, failure);
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

  private recordFailure(call: LogicalCall, reg: GatewayProvider, entry: ModelEntry, error: AIProviderError): void {
    call.failures.push({ provider: reg.id, model: entry.model, kind: error.kind, status: error.status || undefined });
    this.counters.failuresByKind[error.kind] = (this.counters.failuresByKind[error.kind] ?? 0) + 1;
    // A quota that is spent does not recover in minutes: remember it, so later calls go straight to
    // a fallback that can serve them (see plan()).
    if (error.kind === "AI_PROVIDER_QUOTA_EXCEEDED" && this.options.quotaCooldownMs > 0) {
      this.cooldowns.set(reg.id, { until: this.now() + this.options.quotaCooldownMs, error });
    }
  }

  private succeed(call: LogicalCall, meta: AICallMeta): void {
    // The provider answered: whatever cooldown it was under is over.
    this.cooldowns.delete(meta.provider as GatewayProviderId);
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
      attempts: records.map((record) => ({
        provider: record.provider,
        model: record.servedModel ?? record.configuredModel,
        outcome: record.outcome,
        status: record.status,
        httpRequests: record.httpRequests,
        latencyMs: record.latencyMs,
        fallback: record.fallback,
      })),
      ...(error ? { errorKind: error.kind, errorStatus: error.status || undefined, quotaType: error.quotaType, failedAttempts: error.attempts } : {}),
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
