import { capabilitySet, type Capability, type Requirements } from "./capabilities.js";
import { AIProviderError } from "./geminiErrors.js";
import { MODEL_ID_PATTERN, missingCapabilities, OPENROUTER_IMAGE_MIME_TYPES, type ModelEntry } from "./modelCatalog.js";
import { MAX_MODELS_PER_REQUEST } from "./openRouterProvider.js";
import { NO_REDIRECTS, isUsableApiKey, openRouterHeaders, openRouterUrl } from "./openRouterHttp.js";
import { logger } from "../security/redact.js";

/**
 * What OpenRouter itself says about its models, and how ZARVIS uses it.
 *
 * OpenRouter's free models come and go: `inclusionai/ling-3.0-flash-sante:free` passed the live probe on
 * 2026-10-04 and was answered `404 No endpoints found` on 2026-10-15, because it was no longer offered.
 * A model id typed into an environment variable goes stale; the model list does not. So the list is
 * read (and cached) from OpenRouter's documented endpoints and used to:
 *
 * - **check the configured model** before a request is spent on it, and replace it when it is gone;
 * - **read capabilities** (tools, structured output, image input, reasoning, context size, price) from
 *   the provider's own metadata instead of relying only on what an operator declared;
 * - **choose compatible alternates** for the request (free by default, within the operator's price
 *   limit), which OpenRouter then tries in order inside the one request (`models` array);
 * - **remember a model that answered 404** so the next request does not choose it again.
 *
 * Endpoints (both return the same shape): `GET /models/user` (documented as the list filtered by the
 * caller's provider preferences, privacy settings and guardrails, so a model the account may not use
 * is never offered) and `GET /models` (public, no key). `/models/user` is tried first when a key is
 * set; a 401/403 there is the early sign that the key is rejected, and any other failure falls back to
 * the public list. Data is per instance and in memory; a failed refresh keeps the last good list.
 */

const TTL_MS = 15 * 60_000;
/** A list older than this is not trusted any more (selection falls back to the declared catalog). */
const STALE_MS = 24 * 60 * 60_000;
/** After a failed refresh, wait this long before asking again (OpenRouter is down or slow). */
const FAILURE_BACKOFF_MS = 60_000;
const FETCH_TIMEOUT_MS = 6_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_MODELS = 3_000;
/** How long a model that answered 404 is left out of selection. */
const UNAVAILABLE_MS = 15 * 60_000;
/**
 * OpenRouter's documented router over its free models: it picks a free model that supports what the
 * request needs (tools, images, structured output). It is the last alternate, after named models.
 */
const FREE_ROUTER = "openrouter/free";

export interface OpenRouterModelInfo {
  id: string;
  /** 0 when the list does not say. */
  contextLength: number;
  inputModalities: readonly string[];
  supportedParameters: readonly string[];
  /** US dollars per million tokens; undefined when OpenRouter does not give a fixed price. */
  promptPricePerM?: number;
  completionPricePerM?: number;
  free: boolean;
  /** Epoch ms after which OpenRouter stops serving the model, when it announces one. */
  expiresAt?: number;
}

const priceOf = (value: unknown): number | undefined => {
  // A blank price is "not stated", not zero: `Number("")` is 0, which would make an unpriced model look free.
  const n = typeof value === "string" ? (value.trim() === "" ? NaN : Number(value)) : typeof value === "number" ? value : NaN;
  // A negative price is OpenRouter's marker for "varies" (routers): not a fixed price.
  return Number.isFinite(n) && n >= 0 ? n * 1_000_000 : undefined;
};

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 64) : []);

/** Reads OpenRouter's `GET /models` (or `/models/user`) payload defensively: an entry it cannot use is ignored. */
export function parseOpenRouterModels(json: unknown): OpenRouterModelInfo[] {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const models: OpenRouterModelInfo[] = [];
  for (const entry of data.slice(0, MAX_MODELS)) {
    const item = entry as {
      id?: unknown;
      context_length?: unknown;
      architecture?: { input_modalities?: unknown };
      pricing?: { prompt?: unknown; completion?: unknown };
      supported_parameters?: unknown;
      expiration_date?: unknown;
    } | null;
    // An id that is not a plain model id is never logged, printed or sent back to the API.
    if (!item || typeof item.id !== "string" || !MODEL_ID_PATTERN.test(item.id)) continue;
    const contextLength = Number(item.context_length);
    const prompt = priceOf(item.pricing?.prompt);
    const completion = priceOf(item.pricing?.completion);
    const expires = typeof item.expiration_date === "string" ? Date.parse(item.expiration_date) : NaN;
    // `:free` variants and OpenRouter's own free router cost nothing, whatever their metadata says about price.
    const free = item.id.endsWith(":free") || item.id === FREE_ROUTER || (prompt === 0 && completion === 0);
    const promptPrice = free ? 0 : prompt;
    const completionPrice = free ? 0 : completion;
    models.push({
      id: item.id,
      contextLength: Number.isFinite(contextLength) && contextLength > 0 ? contextLength : 0,
      inputModalities: stringList(item.architecture?.input_modalities),
      supportedParameters: stringList(item.supported_parameters),
      ...(promptPrice !== undefined ? { promptPricePerM: promptPrice } : {}),
      ...(completionPrice !== undefined ? { completionPricePerM: completionPrice } : {}),
      free,
      ...(Number.isFinite(expires) ? { expiresAt: expires } : {}),
    });
  }
  return models;
}

// ---- the capabilities a model's metadata proves -------------------------------------------------

/** The capabilities OpenRouter's metadata states, plus anything the operator declared on top of it. */
export function entryFromInfo(info: OpenRouterModelInfo, declared?: ModelEntry): ModelEntry {
  const on = new Set<Capability>(["streaming"]);
  const parameters = new Set(info.supportedParameters);
  if (parameters.has("tools")) on.add("tools");
  if (parameters.has("structured_outputs") || parameters.has("response_format")) on.add("structuredOutput");
  if (parameters.has("reasoning") || parameters.has("include_reasoning")) on.add("reasoning");
  if (info.inputModalities.includes("image")) on.add("vision");
  if (declared) for (const capability of Object.keys(declared.capabilities) as Capability[]) if (declared.capabilities[capability]) on.add(capability);
  const contextTokens = info.contextLength > 0 ? info.contextLength : (declared?.contextTokens ?? 32_768);
  return {
    provider: "openrouter",
    model: info.id,
    enabled: declared?.enabled ?? true,
    free: info.free,
    priority: declared?.priority ?? 2,
    contextTokens,
    capabilities: capabilitySet(on, contextTokens),
    imageMimeTypes: on.has("vision") ? (declared?.imageMimeTypes.length ? declared.imageMimeTypes : OPENROUTER_IMAGE_MIME_TYPES) : [],
    jsonSchema: parameters.has("structured_outputs") || declared?.jsonSchema === true,
  };
}

// ---- choosing models ----------------------------------------------------------------------------

export interface OpenRouterRoutingPolicy {
  /** Allow alternates that cost money. The configured (pinned) model is always allowed, as the operator chose it. */
  allowPaid: boolean;
  /** A price ceiling in US dollars per million tokens; a model above it is never chosen, and OpenRouter is told too. */
  maxPricePromptPerM?: number;
  maxPriceCompletionPerM?: number;
  /** Operator-named alternates, tried before any the list suggests. */
  explicitAlternates: readonly string[];
}

export interface Selection {
  /** Best first. The first is the model to use; the rest are sent as OpenRouter's fallback models. */
  models: ModelEntry[];
  /** Why a configured or named model was not used, for the log. Ids only; nothing from user content. */
  notes: string[];
}

function withinPrice(info: OpenRouterModelInfo, policy: OpenRouterRoutingPolicy): boolean {
  if (policy.maxPricePromptPerM !== undefined && (info.promptPricePerM === undefined || info.promptPricePerM > policy.maxPricePromptPerM)) return false;
  if (policy.maxPriceCompletionPerM !== undefined && (info.completionPricePerM === undefined || info.completionPricePerM > policy.maxPriceCompletionPerM)) return false;
  return true;
}

/**
 * The models that may answer a request, from live data. Pure: the same inputs give the same answer.
 *
 * 1. The configured models (`declared`, the operator's choice) that are still in the list and can serve
 *    the request, in their declared order.
 * 2. Models the operator named as alternates, if they are listed and can serve it.
 * 3. Models the list suggests: not a router, not expired, not recently refused, within the price rules
 *    (free unless `allowPaid`), able to serve the request, largest context first.
 *
 * At most {@link MAX_MODELS_PER_REQUEST} are returned (OpenRouter's limit for one request).
 */
export function selectOpenRouterModels(input: {
  infos: readonly OpenRouterModelInfo[];
  declared: readonly ModelEntry[];
  needs: Requirements;
  policy: OpenRouterRoutingPolicy;
  isUnavailable: (id: string) => boolean;
  now: number;
}): Selection {
  const { infos, declared, needs, policy, isUnavailable, now } = input;
  const byId = new Map(infos.map((info) => [info.id, info]));
  const notes: string[] = [];
  const chosen: ModelEntry[] = [];
  const taken = new Set<string>();
  const usable = (info: OpenRouterModelInfo, entry: ModelEntry): string | undefined => {
    if (isUnavailable(info.id)) return "refused_recently";
    if (info.expiresAt !== undefined && info.expiresAt <= now) return "expired";
    if (!withinPrice(info, policy)) return "over_price_limit";
    const missing = missingCapabilities(entry, needs);
    return missing.length > 0 ? `missing:${missing.join("+")}` : undefined;
  };

  const pinned = declared.filter((entry) => entry.provider === "openrouter" && entry.enabled).sort((a, b) => a.priority - b.priority);
  for (const entry of pinned) {
    const info = byId.get(entry.model);
    if (!info) {
      notes.push(`${entry.model}: not_in_live_list`);
      continue;
    }
    const live = entryFromInfo(info, entry);
    const why = usable(info, live);
    if (why) notes.push(`${entry.model}: ${why}`);
    else if (!taken.has(live.model)) {
      chosen.push(live);
      taken.add(live.model);
    }
  }

  for (const id of policy.explicitAlternates) {
    const info = byId.get(id);
    if (!info) {
      notes.push(`${id}: not_in_live_list`);
      continue;
    }
    const live = entryFromInfo(info);
    const why = usable(info, live);
    if (why) notes.push(`${id}: ${why}`);
    else if (!taken.has(id)) {
      chosen.push(live);
      taken.add(id);
    }
  }

  // The free router goes last, so it needs a slot of its own; the models in front of it are the largest-context ones that fit.
  const routerInfo = byId.get(FREE_ROUTER);
  const router = routerInfo && !taken.has(FREE_ROUTER) ? entryFromInfo(routerInfo) : undefined;
  const routerUsable = routerInfo !== undefined && router !== undefined && usable(routerInfo, router) === undefined;
  const slots = MAX_MODELS_PER_REQUEST - (routerUsable ? 1 : 0);
  if (chosen.length < slots) {
    const suggested = infos
      .filter((info) => !taken.has(info.id) && !info.id.startsWith("openrouter/") && (info.free || policy.allowPaid))
      .map((info) => ({ info, entry: entryFromInfo(info) }))
      .filter(({ info, entry }) => usable(info, entry) === undefined)
      .sort((a, b) => b.info.contextLength - a.info.contextLength || a.info.id.localeCompare(b.info.id));
    for (const { entry } of suggested) {
      if (chosen.length >= slots) break;
      chosen.push(entry);
    }
  }
  if (routerUsable && chosen.length < MAX_MODELS_PER_REQUEST) chosen.push(router!);
  return { models: chosen.slice(0, MAX_MODELS_PER_REQUEST), notes };
}

// ---- the live directory -------------------------------------------------------------------------

export interface DirectoryOptions {
  /** Read per request, like the chat adapter's key. */
  apiKey: () => string | undefined;
  baseUrl?: string;
  now?: () => number;
  ttlMs?: number;
}

export interface DirectoryStatus {
  loaded: boolean;
  fresh: boolean;
  models: number;
  freeModelsWithTools: number;
  /** The last authenticated request was rejected (HTTP 401/403): the key is not accepted. */
  authRejected: boolean;
  source?: "account" | "public";
}

export class OpenRouterModelDirectory {
  private infos: OpenRouterModelInfo[] | undefined;
  private loadedAt = 0;
  private failedAt = 0;
  private source: "account" | "public" | undefined;
  private inflight: Promise<void> | undefined;
  private rejectedAt: number | undefined;
  private accountEndpointMissing = false;
  private readonly refused = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly options: DirectoryOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Live data we may still rely on (a stale list is better than none, up to a day). */
  hasData(): boolean {
    return this.infos !== undefined && this.now() - this.loadedAt < STALE_MS;
  }

  isFresh(): boolean {
    if (this.infos && this.now() - this.loadedAt < (this.options.ttlMs ?? TTL_MS)) return true;
    // A refresh that just failed is not retried at once.
    return this.failedAt > 0 && this.now() - this.failedAt < FAILURE_BACKOFF_MS;
  }

  models(): readonly OpenRouterModelInfo[] {
    return this.hasData() ? this.infos! : [];
  }

  /** Brings the list up to date when it is stale. Never throws; concurrent callers share one request. */
  async ensureFresh(): Promise<void> {
    if (this.isFresh()) return;
    this.inflight ??= this.load().finally(() => {
      this.inflight = undefined;
    });
    await this.inflight;
  }

  markUnavailable(id: string): void {
    this.refused.set(id, this.now() + UNAVAILABLE_MS);
  }

  isUnavailable(id: string): boolean {
    const until = this.refused.get(id);
    if (until === undefined) return false;
    if (until <= this.now()) {
      this.refused.delete(id);
      return false;
    }
    return true;
  }

  authRejected(): boolean {
    return this.rejectedAt !== undefined;
  }

  /** Another request with the same key succeeded, so the rejection the list saw is out of date. */
  clearAuthRejected(): void {
    this.rejectedAt = undefined;
  }

  status(): DirectoryStatus {
    const infos = this.models();
    return {
      loaded: this.hasData(),
      fresh: this.isFresh(),
      models: infos.length,
      freeModelsWithTools: infos.filter((info) => info.free && info.supportedParameters.includes("tools")).length,
      authRejected: this.authRejected(),
      ...(this.source ? { source: this.source } : {}),
    };
  }

  private async load(): Promise<void> {
    try {
      const { infos, source } = await this.fetchList();
      this.infos = infos;
      this.source = source;
      this.loadedAt = this.now();
      this.failedAt = 0;
    } catch (error) {
      this.failedAt = this.now();
      logger.warn("OpenRouter model list could not be refreshed", { reason: error instanceof Error ? error.message.slice(0, 120) : "unknown", keptLast: this.infos !== undefined });
    }
  }

  private async fetchList(): Promise<{ infos: OpenRouterModelInfo[]; source: "account" | "public" }> {
    const key = this.options.apiKey();
    if (key && isUsableApiKey(key) && !this.accountEndpointMissing) {
      const account = await this.get("models/user", key);
      if (account.status === 200) {
        this.rejectedAt = undefined;
        return { infos: parseOpenRouterModels(account.json), source: "account" };
      }
      if (account.status === 401 || account.status === 403) this.rejectedAt = this.now();
      // An account that does not have this endpoint is not asked again; anything else falls back to the public list.
      else if (account.status === 404) this.accountEndpointMissing = true;
    }
    const pub = await this.get("models");
    if (pub.status !== 200) throw new Error(`model list answered HTTP ${pub.status}`);
    return { infos: parseOpenRouterModels(pub.json), source: "public" };
  }

  private async get(path: string, key?: string): Promise<{ status: number; json?: unknown }> {
    const res = await fetch(openRouterUrl(this.options.baseUrl, path), {
      method: "GET",
      headers: openRouterHeaders(key, { accept: "application/json" }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      ...NO_REDIRECTS,
    });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return { status: res.status };
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      await res.body?.cancel().catch(() => {});
      throw new Error("model list is larger than the limit");
    }
    return { status: 200, json: JSON.parse(await readLimited(res, MAX_BODY_BYTES)) };
  }
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("model list is larger than the limit");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text + decoder.decode();
}

// ---- the gateway's view of it -------------------------------------------------------------------

/** What the ModelGateway needs from a provider's live data (see `modelGateway.ts`). */
export interface DynamicCatalog {
  /** True when live data is available (possibly stale). */
  hasData(): boolean;
  /** True when the live data is recent enough that {@link refresh} would not fetch. */
  isFresh(): boolean;
  /** Brings the live data up to date when it is stale. Never throws. */
  refresh(): Promise<void>;
  /** The models that may answer `needs`, best first; undefined when there is no live data. */
  select(needs: Requirements, declared: readonly ModelEntry[]): Selection | undefined;
  /** A request to `model` failed: remember a 404 so the model is not chosen again for a while. */
  noteFailure(model: string, error: AIProviderError): void;
  /** A request to this provider succeeded: its credential is accepted. */
  noteSuccess(): void;
  /** The provider rejected the key. */
  authRejected(): boolean;
  status(): DirectoryStatus;
}

export class OpenRouterCatalog implements DynamicCatalog {
  constructor(
    readonly directory: OpenRouterModelDirectory,
    private readonly policy: OpenRouterRoutingPolicy,
    private readonly now: () => number = Date.now,
  ) {}

  hasData(): boolean {
    return this.directory.hasData();
  }

  isFresh(): boolean {
    return this.directory.isFresh();
  }

  refresh(): Promise<void> {
    return this.directory.ensureFresh();
  }

  select(needs: Requirements, declared: readonly ModelEntry[]): Selection | undefined {
    if (!this.directory.hasData()) return undefined;
    return selectOpenRouterModels({
      infos: this.directory.models(),
      declared,
      needs,
      policy: this.policy,
      isUnavailable: (id) => this.directory.isUnavailable(id),
      now: this.now(),
    });
  }

  noteFailure(model: string, error: AIProviderError): void {
    // 404 is OpenRouter's "no endpoints found": the model is gone, or the account may not use it.
    if (error.status === 404) this.directory.markUnavailable(model);
  }

  noteSuccess(): void {
    this.directory.clearAuthRejected();
  }

  authRejected(): boolean {
    return this.directory.authRejected();
  }

  status(): DirectoryStatus {
    return this.directory.status();
  }
}
