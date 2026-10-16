import { randomUUID } from "node:crypto";
import { AIProviderError, abortError, retryDelayMs, sleep, type ProviderFailure } from "./geminiErrors.js";
import { beginModelCall, type ModelCallRecord } from "./callTrace.js";
import { classifyOpenRouterFailure, openRouterBodyError, toOpenRouterError } from "./openRouterErrors.js";
import { DEFAULT_OPENROUTER_BASE_URL, NO_REDIRECTS, isUsableApiKey, openRouterHeaders, openRouterUrl, unusableKeyError } from "./openRouterHttp.js";
import { IMAGE_ANALYSIS_MAX_OUTPUT_TOKENS, IMAGE_ANALYSIS_SYSTEM_PROMPT, IMAGE_ANALYSIS_USER_PROMPT } from "./imageAnalysisPrompts.js";
import { logger } from "../security/redact.js";
import type {
  AIProvider,
  AIRequest,
  AIResponse,
  AIResponseChunk,
  ImageAnalysisRequest,
  ImageAnalysisResult,
  ProviderTrace,
  TokenUsage,
  ToolCallRequest,
  ToolDefinition,
} from "./provider.js";
import { isAbortError, isTransportError, readJsonBody, readWithIdleLimit, timeoutError, transportFailure, unreadableResponse } from "./transportErrors.js";

/**
 * OpenRouter through its OpenAI-compatible Chat Completions API
 * (`POST {baseUrl}/chat/completions`, `Authorization: Bearer <key>`).
 *
 * This adapter translates ZARVIS's provider-neutral request into that wire format and back. It
 * does not decide *whether* a model may be used for a request: that is the ModelGateway's job,
 * from the model's capabilities (declared by the operator or read from OpenRouter's live model
 * list, see `openRouterModels.ts`). What it does guarantee is that it never pretends:
 *
 * - tools and structured outputs are sent with `provider.require_parameters = true`, so OpenRouter
 *   routes only to an endpoint that actually supports them instead of silently dropping them;
 * - a tool call whose arguments are not valid JSON becomes an EMPTY input (the pipeline then
 *   reports the missing fields), never an invented one;
 * - a tool-using request is refused for streaming rather than losing the calls.
 *
 * Retry policy is the shared one (ai/geminiErrors.ts `retryDelayMs`). The gateway picks the model.
 * When it also names `fallbackModels`, they are sent in OpenRouter's `models` array: OpenRouter then
 * tries them in order inside the SAME HTTP request (so a retired or unavailable model costs no extra
 * request of ours), and `servedModel` records which one actually answered. A router such as
 * `openrouter/free` does its own selection server side.
 *
 * The time limit covers the whole answer, not only the headers: a body that stalls after a 200 is
 * given up on (`timeoutMs` for a JSON answer; `streamIdleTimeoutMs` of silence for a stream).
 *
 * The same adapter speaks for the `openai` provider (`flavor: "openai"`): any OpenAI-compatible Chat
 * Completions endpoint, OpenAI's own by default. It sends the plain OpenAI request: no `models` array, no
 * `provider` routing preferences and no OpenRouter attribution headers, which such an endpoint would reject or
 * ignore. Everything else (tool encoding, the time limits, the retry policy, the error classification) is shared.
 */
export { DEFAULT_OPENROUTER_BASE_URL };
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 30_000;
/** Requested when the caller sets no limit: an unbounded request can be refused for credit reasons. */
const DEFAULT_MAX_TOKENS = 4096;
/** OpenRouter accepts at most this many models in the `models` array (the first is the primary). */
export const MAX_MODELS_PER_REQUEST = 3;

/** Per-request limits that keep spend and data handling inside what the operator chose. */
export interface OpenRouterRequestPolicy {
  /** Sent as `provider.data_collection`. Unset: the account's own privacy settings decide. */
  dataCollection?: "allow" | "deny";
  /** Sent as `provider.max_price` (US dollars per million tokens): OpenRouter skips pricier endpoints. */
  maxPricePromptPerM?: number;
  maxPriceCompletionPerM?: number;
  /** A hard ceiling on `max_tokens`, whatever the caller asked for. */
  maxOutputTokens?: number;
}

export interface OpenRouterProviderOptions {
  /** `openrouter` (default) or `openai`: any other OpenAI-compatible endpoint (see the note above). */
  flavor?: "openrouter" | "openai";
  /** A function, so the key is read per request and the gateway can ask `isConfigured()`. */
  apiKey: string | (() => string | undefined);
  baseUrl?: string;
  /** Time allowed for one request: the response headers and, for a JSON answer, the body (default 60 s). */
  timeoutMs?: number;
  /** How long a stream may go quiet before it is given up (default 30 s). */
  streamIdleTimeoutMs?: number;
  policy?: OpenRouterRequestPolicy;
}

interface OpenAiToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: unknown };
}

interface OpenRouterChoice {
  message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
  delta?: { content?: string | null };
  finish_reason?: string | null;
  error?: unknown;
}

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  /** What this request cost, in US dollars. */
  cost?: number;
}

interface OpenRouterResponse {
  id?: string;
  model?: string;
  choices?: OpenRouterChoice[];
  usage?: OpenRouterUsage;
  error?: unknown;
}

type OpenAiContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
interface OpenAiMessage {
  role: "system" | "user" | "assistant";
  content: OpenAiContent;
}

/** A request that has been answered with a 2xx status; the caller reads the body, then calls `stop()`. */
interface Posted {
  res: Response;
  call: ModelCallRecord;
  /** Ends the time limit of this request. Always call it once the body is read (or abandoned). */
  stop(): void;
  /** True when the limit, not the caller, aborted the request. */
  timedOut(): boolean;
}

export class OpenRouterProvider implements AIProvider {
  readonly id: "openrouter" | "openai";
  readonly supportsJsonSchema = true;
  /** For messages and logs: "OpenRouter" or "OpenAI-compatible". */
  private readonly name: string;
  private readonly label: string;
  /** OpenRouter's request extensions: the `models` array and `provider` preferences. */
  private readonly extensions: boolean;

  constructor(private readonly options: OpenRouterProviderOptions) {
    this.id = options.flavor ?? "openrouter";
    this.extensions = this.id === "openrouter";
    this.name = this.extensions ? "OpenRouter" : "OpenAI-compatible";
    this.label = `${this.name} chat completions`;
  }

  private key(): string {
    const key = typeof this.options.apiKey === "function" ? this.options.apiKey() : this.options.apiKey;
    if (!key) {
      throw new AIProviderError(`${this.name} API key is not configured`, "AI_UNAVAILABLE", 503, false, undefined, undefined, {}, { provider: this.id });
    }
    if (!isUsableApiKey(key)) throw unusableKeyError(this.id, this.name);
    return key;
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const model = request.modelConfig.model;
    const { names, body } = buildChatBody(request, false, this.options.policy, this.extensions);
    const posted = await this.post(body, { kind: request.purpose ?? "planner", model, request });
    const json = await this.readJson<OpenRouterResponse>(posted, this.label, model, request);
    return this.fromResponse(json, model, names, posted.call, request.trace);
  }

  async *streamGenerate(request: AIRequest): AsyncIterable<AIResponseChunk> {
    if (request.tools && request.tools.length > 0) {
      // The stream carries text only. Dropping tool calls would let the model "use" a tool that
      // never ran, so a tool-using request must not be streamed.
      throw new AIProviderError("Streaming a request with tools is not supported", "AI_UNAVAILABLE", 0, false, undefined, undefined, {}, {
        kind: "AI_PROVIDER_CAPABILITY_UNSUPPORTED",
        provider: this.id,
      });
    }
    const model = request.modelConfig.model;
    const { body } = buildChatBody(request, true, this.options.policy, this.extensions);
    // Retries happen only inside post(), before any byte of the stream was read, so text that
    // was already delivered is never repeated.
    const { res, call, stop } = await this.post(body, { kind: request.purpose ?? "planner", model, request, stream: true });
    // The header time limit is over; from here a stream is bounded by how long it may stay silent.
    stop();
    if (!res.body) throw unreadableResponse(this.label, this.id, model);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const idleMs = this.options.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
    let buffer = "";
    let finished = false;
    let usage: OpenRouterUsage | undefined;
    const handle = (line: string): string | undefined => {
      const trimmed = line.trim();
      // Comment lines (": OPENROUTER PROCESSING") keep the connection alive; they carry no data.
      if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) return undefined;
      const payload = trimmed.slice("data:".length).trim();
      if (payload === "[DONE]") {
        finished = true;
        return undefined;
      }
      let chunk: OpenRouterResponse;
      try {
        chunk = JSON.parse(payload) as OpenRouterResponse;
      } catch {
        throw unreadableResponse(this.label, this.id, model);
      }
      // A failure after the stream started arrives as data inside an HTTP 200.
      if (chunk.error) throw openRouterBodyError(this.label, chunk.error, model, this.id);
      const choice = chunk.choices?.[0];
      if (choice?.error) throw openRouterBodyError(this.label, choice.error, model, this.id);
      if (chunk.id && request.trace && !request.trace.responseIds.includes(chunk.id)) request.trace.responseIds.push(chunk.id);
      if (chunk.model) call.servedModel = chunk.model;
      // The last chunk carries the usage (and cost) of the whole answer.
      if (chunk.usage) usage = chunk.usage;
      const delta = choice?.delta?.content;
      return typeof delta === "string" && delta.length > 0 ? delta : undefined;
    };
    try {
      while (!finished) {
        const { value, done } = await readWithIdleLimit(() => reader.read(), idleMs, () => timeoutError(`${this.name} stream`, this.id, model));
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const text = handle(line);
          if (text) yield { delta: text, done: false };
          if (finished) break;
        }
      }
      if (!finished) {
        const text = handle(buffer);
        if (text) yield { delta: text, done: false };
      }
    } catch (error) {
      if (isAbortError(error) || error instanceof AIProviderError || !isTransportError(error)) throw error;
      throw transportFailure(this.label, this.id, error, model);
    } finally {
      // Also runs when the consumer stops early: cancel the upstream response.
      await reader.cancel().catch(() => {});
    }
    this.noteServed({ model: call.servedModel, usage }, model, call, request.trace);
    yield { delta: "", done: true };
  }

  async analyzeImage(request: ImageAnalysisRequest): Promise<ImageAnalysisResult> {
    const model = request.modelConfig.model;
    const messages: OpenAiMessage[] = [
      { role: "system", content: IMAGE_ANALYSIS_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: IMAGE_ANALYSIS_USER_PROMPT },
          { type: "image_url", image_url: { url: `data:${request.mimeType};base64,${request.data.toString("base64")}` } },
        ],
      },
    ];
    const rest = { messages, max_tokens: capTokens(IMAGE_ANALYSIS_MAX_OUTPUT_TOKENS, this.options.policy), stream: false };
    const body = this.extensions ? modelFields(model, request.modelConfig.fallbackModels, rest) : { model, ...rest };
    const price = this.extensions ? providerPreferences(false, this.options.policy) : undefined;
    if (price) body.provider = price;
    const posted = await this.post(body, { kind: "vision", model, request });
    const json = await this.readJson<OpenRouterResponse>(posted, `${this.name} image analysis`, model, request);
    this.checkBody(json, model);
    if (json.id) request.trace?.responseIds.push(json.id);
    this.noteServed(json, model, posted.call, request.trace);
    const text = json.choices?.[0]?.message?.content;
    // An empty analysis is not a provider outage and not a reason to switch providers.
    if (typeof text !== "string" || !text.trim()) throw new Error(`${this.name} returned an empty image analysis`);
    return { text: text.trim() };
  }

  /**
   * One logical request with the shared retry policy. A network failure and a transient 5xx get
   * a bounded backoff; a daily quota, an empty balance, or any other failure ends the call.
   */
  private async post(
    body: unknown,
    context: { kind: ModelCallRecord["kind"]; model: string; request: Pick<AIRequest, "signal" | "trace" | "modelCallId">; stream?: boolean },
  ): Promise<Posted> {
    const { model, request } = context;
    const call = beginModelCall(context.kind, model, request.modelCallId, this.id);
    const key = this.key();
    const url = openRouterUrl(this.options.baseUrl ?? (this.extensions ? DEFAULT_OPENROUTER_BASE_URL : DEFAULT_OPENAI_BASE_URL), "chat/completions");
    const payload = JSON.stringify(body);
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let lastError: Error | undefined;

    for (let attempt = 0; ; attempt += 1) {
      if (request.signal?.aborted) throw abortError();
      if (request.trace) request.trace.httpRequests += 1;
      call.httpRequests += 1;

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const stop = () => clearTimeout(timer);
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: this.headers(key, context.stream),
          body: payload,
          signal: request.signal ? AbortSignal.any([controller.signal, request.signal]) : controller.signal,
          ...NO_REDIRECTS,
        });
      } catch (error) {
        stop();
        if (request.signal?.aborted) throw abortError();
        if (isAbortError(error)) {
          const failed = timeoutError(`${this.name} request`, this.id, model);
          call.failure = { code: failed.code, model };
          throw failed;
        }
        if (!isTransportError(error)) throw error;
        lastError = transportFailure(this.label, this.id, error, model);
        call.failure = { code: "AI_UNAVAILABLE", model };
        const wait = retryDelayMs({ kind: "transient" }, attempt);
        if (wait === null) throw lastError;
        await sleep(wait, request.signal);
        continue;
      }

      if (res.ok) {
        call.servedModel = model;
        call.outcome = "ok";
        request.trace?.servedModels?.push(model);
        return { res, call, stop, timedOut: () => timedOut };
      }

      call.status = res.status;
      // The time limit is still running here: an error body that stalls cannot pin the request.
      const text = await res.text().catch(() => "");
      stop();
      if (timedOut && !request.signal?.aborted) {
        const failed = timeoutError(`${this.name} request`, this.id, model);
        call.failure = { code: failed.code, model };
        throw failed;
      }
      const failure: ProviderFailure = classifyOpenRouterFailure(res.status, text, res.headers.get("retry-after"));
      const providerError = toOpenRouterError(this.label, res.status, res.statusText, failure, text, model, this.id);
      lastError = providerError;
      call.failure = { code: providerError.code, quotaType: providerError.quotaType, ...providerError.evidence };
      const wait = retryDelayMs(failure, attempt);
      if (wait === null) throw lastError;
      await sleep(wait, request.signal);
    }
  }

  /** Reads a 2xx JSON body inside the request's time limit; a body that stalls is a timeout, not a cancellation. */
  private async readJson<T>(posted: Posted, label: string, model: string, request: Pick<AIRequest, "signal">): Promise<T> {
    try {
      return await readJsonBody<T>(posted.res, label, this.id, model);
    } catch (error) {
      if (isAbortError(error) && posted.timedOut() && !request.signal?.aborted) {
        const failed = timeoutError(`${this.name} request`, this.id, model);
        posted.call.failure = { code: failed.code, model };
        throw failed;
      }
      throw error;
    } finally {
      posted.stop();
    }
  }

  /** A 2xx whose body is an error or has no usable choice is a provider failure, not an answer. */
  private checkBody(json: OpenRouterResponse, model: string): void {
    if (json.error) throw openRouterBodyError(this.label, json.error, model, this.id);
    const choice = json.choices?.[0];
    if (choice?.error) throw openRouterBodyError(this.label, choice.error, model, this.id);
    if (!choice) throw unreadableResponse(this.label, this.id, model);
  }

  /** OpenRouter gets its attribution headers; another endpoint only the key and the content types. */
  private headers(key: string, stream: boolean | undefined): Record<string, string> {
    const extra = { "content-type": "application/json", ...(stream ? { accept: "text/event-stream" } : {}) };
    return this.extensions ? openRouterHeaders(key, extra) : { authorization: `Bearer ${key}`, ...extra };
  }

  private noteServed(json: { model?: string; usage?: OpenRouterUsage }, model: string, call: ModelCallRecord, trace?: ProviderTrace): void {
    const served = json.model || model;
    call.servedModel = served;
    // `servedModels` already holds the requested model from post(); replace it by the real one.
    const models = trace?.servedModels;
    if (models && models[models.length - 1] === model && served !== model) models[models.length - 1] = served;
    const usage = toUsage(json.usage);
    call.promptTokens = usage.promptTokens;
    call.completionTokens = usage.completionTokens;
    if (usage.costUsd !== undefined) call.costUsd = usage.costUsd;
  }

  private fromResponse(
    json: OpenRouterResponse,
    model: string,
    names: Map<string, string> | undefined,
    call: ModelCallRecord,
    trace?: ProviderTrace,
  ): AIResponse {
    this.checkBody(json, model);
    if (json.id) trace?.responseIds.push(json.id);
    this.noteServed(json, model, call, trace);
    const message = json.choices![0]!.message;
    const toolCalls: ToolCallRequest[] = [];
    for (const raw of message?.tool_calls ?? []) {
      const encoded = raw.function?.name;
      if (!encoded) continue;
      const skillId = decodeToolName(encoded, names);
      toolCalls.push({ id: raw.id || randomUUID(), skillId, input: parseArguments(raw.function?.arguments, skillId) });
    }
    return {
      message: { role: "assistant", content: typeof message?.content === "string" ? message.content : "" },
      toolCalls,
      usage: toUsage(json.usage),
    };
  }
}

function toUsage(usage: OpenRouterUsage | undefined): TokenUsage {
  const cost = typeof usage?.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0 ? usage.cost : undefined;
  return { promptTokens: usage?.prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0, ...(cost !== undefined ? { costUsd: cost } : {}) };
}

// ---- request translation -------------------------------------------------------------------------

/** `model`, or OpenRouter's `models` array when the gateway named alternates (the first is the primary). */
function modelFields(model: string, fallbackModels: readonly string[] | undefined, rest: Record<string, unknown>): Record<string, unknown> {
  const models = [model, ...(fallbackModels ?? [])].filter((id, index, all) => all.indexOf(id) === index).slice(0, MAX_MODELS_PER_REQUEST);
  return models.length > 1 ? { models, ...rest } : { model, ...rest };
}

function capTokens(requested: number, policy: OpenRouterRequestPolicy | undefined): number {
  return policy?.maxOutputTokens !== undefined ? Math.min(requested, policy.maxOutputTokens) : requested;
}

/** The `provider` routing preferences: require supported parameters, and the operator's data and price limits. */
function providerPreferences(needsParameters: boolean, policy: OpenRouterRequestPolicy | undefined): Record<string, unknown> | undefined {
  const preferences: Record<string, unknown> = {};
  if (needsParameters) preferences.require_parameters = true;
  if (policy?.dataCollection) preferences.data_collection = policy.dataCollection;
  const maxPrice: Record<string, number> = {};
  if (policy?.maxPricePromptPerM !== undefined) maxPrice.prompt = policy.maxPricePromptPerM;
  if (policy?.maxPriceCompletionPerM !== undefined) maxPrice.completion = policy.maxPriceCompletionPerM;
  if (Object.keys(maxPrice).length > 0) preferences.max_price = maxPrice;
  return Object.keys(preferences).length > 0 ? preferences : undefined;
}

/**
 * Builds the Chat Completions body. `names` maps the tool names sent to OpenRouter back to skill
 * ids: skill ids contain a dot (`web.search`), which the OpenAI-style function-name pattern
 * (`[A-Za-z0-9_-]`) does not allow.
 */
export function buildChatBody(
  request: AIRequest,
  stream: boolean,
  policy?: OpenRouterRequestPolicy,
  /** False for a plain OpenAI-compatible endpoint: no `models` array, no `provider` preferences. */
  extensions = true,
): { body: Record<string, unknown>; names?: Map<string, string> } {
  const messages: OpenAiMessage[] = [];
  if (request.systemPrompt) messages.push({ role: "system", content: request.systemPrompt });
  for (const message of request.messages) {
    // `systemPrompt` is the only system channel (the Gemini adapter drops system-role messages too).
    if (message.role === "system") continue;
    // Our messages carry no structured tool-call linkage, so a tool result is passed as a
    // labelled user turn, exactly as the Gemini adapter does.
    if (message.role === "tool") messages.push({ role: "user", content: `[Tool result] ${message.content}` });
    else messages.push({ role: message.role, content: message.content });
  }

  const rest = { messages, stream, max_tokens: capTokens(request.modelConfig.maxTokens ?? DEFAULT_MAX_TOKENS, policy) };
  const body: Record<string, unknown> = extensions ? modelFields(request.modelConfig.model, request.modelConfig.fallbackModels, rest) : { model: request.modelConfig.model, ...rest };
  if (request.modelConfig.temperature !== undefined) body.temperature = request.modelConfig.temperature;

  let names: Map<string, string> | undefined;
  if (request.tools && request.tools.length > 0) {
    const encoded = encodeTools(request.tools);
    body.tools = encoded.tools;
    names = encoded.names;
  }
  if (request.responseFormat === "json") {
    body.response_format = { type: "json_object" };
  } else if (request.responseFormat) {
    const { name, schema, strict } = request.responseFormat;
    body.response_format = { type: "json_schema", json_schema: { name, strict: strict !== false, schema } };
  }
  // Without require_parameters OpenRouter may pick an endpoint that ignores tools or response_format.
  const preferences = extensions ? providerPreferences(Boolean(names || request.responseFormat), policy) : undefined;
  if (preferences) body.provider = preferences;
  return { body, names };
}

function encodeTools(tools: ToolDefinition[]): { tools: unknown[]; names: Map<string, string> } {
  const names = new Map<string, string>();
  const out = tools.map((tool) => {
    // Skill ids are `[a-z0-9_.]` with no hyphen, so mapping "." to "-" cannot collide.
    const encoded = tool.name.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64);
    if (names.has(encoded) && names.get(encoded) !== tool.name) {
      throw new AIProviderError("Two tools map to the same provider function name", "AI_UNAVAILABLE", 0, false, undefined, undefined, {}, {
        kind: "AI_INTERNAL_ERROR",
        provider: "openrouter",
      });
    }
    names.set(encoded, tool.name);
    const properties: Record<string, { type: string }> = {};
    for (const [field, type] of Object.entries(tool.inputSchema.properties ?? {})) properties[field] = { type: jsonSchemaType(type) };
    for (const field of tool.inputSchema.requiredFields) if (!properties[field]) properties[field] = { type: "string" };
    return {
      type: "function",
      function: {
        name: encoded,
        description: tool.description,
        parameters: { type: "object", properties, required: tool.inputSchema.requiredFields },
      },
    };
  });
  return { tools: out, names };
}

function jsonSchemaType(type: string): string {
  const t = type.toLowerCase();
  return t === "number" || t === "integer" || t === "boolean" || t === "array" || t === "object" ? t : "string";
}

/**
 * Maps a function name from the model back to a skill id. Exact first; then a unique match
 * ignoring `-`, `_` and `.` (models sometimes rewrite a separator). A name that matches no offered
 * tool is passed through untouched, so the tool pipeline answers "no such skill" rather than the
 * adapter guessing.
 */
function decodeToolName(name: string, names?: Map<string, string>): string {
  if (!names) return name;
  const exact = names.get(name);
  if (exact) return exact;
  const squash = (value: string) => value.toLowerCase().replace(/[-_.]/g, "");
  const wanted = squash(name);
  const matches = [...names.values()].filter((skillId) => squash(skillId) === wanted);
  return matches.length === 1 ? matches[0]! : name;
}

function parseArguments(value: unknown, skillId: string): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // fall through
    }
    logger.warn("OpenRouter returned tool arguments that are not a JSON object; the call runs with empty input", { skillId });
  }
  return {};
}
