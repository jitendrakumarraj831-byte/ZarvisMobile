import { randomUUID } from "node:crypto";
import { AIProviderError, abortError, retryDelayMs, sleep, type ProviderFailure } from "./geminiErrors.js";
import { beginModelCall, type ModelCallRecord } from "./callTrace.js";
import { classifyOpenRouterFailure, openRouterBodyError, toOpenRouterError } from "./openRouterErrors.js";
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
  ToolCallRequest,
  ToolDefinition,
} from "./provider.js";
import { isAbortError, isTransportError, readJsonBody, timeoutError, transportFailure, unreadableResponse } from "./transportErrors.js";

/**
 * OpenRouter through its OpenAI-compatible Chat Completions API
 * (`POST {baseUrl}/chat/completions`, `Authorization: Bearer <key>`).
 *
 * This adapter translates ZARVIS's provider-neutral request into that wire format and back. It
 * does not decide *whether* a model may be used for a request: that is the ModelGateway's job,
 * from the declared capability of the configured model. What it does guarantee is that it never
 * pretends:
 *
 * - tools are sent with `provider.require_parameters = true`, so OpenRouter routes only to an
 *   endpoint that actually supports them instead of silently dropping them;
 * - a tool call whose arguments are not valid JSON becomes an EMPTY input (the pipeline then
 *   reports the missing fields), never an invented one;
 * - a tool-using request is refused for streaming rather than losing the calls.
 *
 * Retry policy is the shared one (ai/geminiErrors.ts `retryDelayMs`). One model per call: the
 * gateway picks it, and a router such as `openrouter/free` does its own selection server side;
 * `servedModel` records which model OpenRouter says actually answered.
 */
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
/** Optional attribution headers OpenRouter documents; they identify this app, not the user. */
const APP_REFERER = "https://zarvismobile.com";
const APP_TITLE = "ZARVIS";
const LABEL = "OpenRouter chat completions";
const DEFAULT_TIMEOUT_MS = 60_000;
/** Requested when the caller sets no limit: an unbounded request can be refused for credit reasons. */
const DEFAULT_MAX_TOKENS = 4096;

export interface OpenRouterProviderOptions {
  /** A function, so the key is read per request and the gateway can ask `isConfigured()`. */
  apiKey: string | (() => string | undefined);
  baseUrl?: string;
  /** Time allowed until response headers arrive (a streamed body is bounded by the caller's signal). */
  timeoutMs?: number;
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

interface OpenRouterResponse {
  id?: string;
  model?: string;
  choices?: OpenRouterChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: unknown;
}

type OpenAiContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
interface OpenAiMessage {
  role: "system" | "user" | "assistant";
  content: OpenAiContent;
}

export class OpenRouterProvider implements AIProvider {
  readonly id = "openrouter";

  constructor(private readonly options: OpenRouterProviderOptions) {}

  private key(): string {
    const key = typeof this.options.apiKey === "function" ? this.options.apiKey() : this.options.apiKey;
    if (!key) {
      throw new AIProviderError("OpenRouter API key is not configured", "AI_UNAVAILABLE", 503, false, undefined, undefined, {}, { provider: this.id });
    }
    return key;
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const model = request.modelConfig.model;
    const { names, body } = buildChatBody(request, false);
    const { res, call } = await this.post(body, { kind: request.purpose ?? "planner", model, request });
    const json = await readJsonBody<OpenRouterResponse>(res, LABEL, this.id, model);
    return this.fromResponse(json, model, names, call, request.trace);
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
    const { body } = buildChatBody(request, true);
    // Retries happen only inside post(), before any byte of the stream was read, so text that
    // was already delivered is never repeated.
    const { res, call } = await this.post(body, { kind: request.purpose ?? "planner", model, request, stream: true });
    if (!res.body) throw unreadableResponse(LABEL, this.id, model);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;
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
        throw unreadableResponse(LABEL, this.id, model);
      }
      // A failure after the stream started arrives as data inside an HTTP 200.
      if (chunk.error) throw openRouterBodyError(LABEL, chunk.error, model);
      const choice = chunk.choices?.[0];
      if (choice?.error) throw openRouterBodyError(LABEL, choice.error, model);
      if (chunk.id && request.trace && !request.trace.responseIds.includes(chunk.id)) request.trace.responseIds.push(chunk.id);
      if (chunk.model) call.servedModel = chunk.model;
      const delta = choice?.delta?.content;
      return typeof delta === "string" && delta.length > 0 ? delta : undefined;
    };
    try {
      while (!finished) {
        const { value, done } = await reader.read();
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
      throw transportFailure(LABEL, this.id, error, model);
    } finally {
      // Also runs when the consumer stops early: cancel the upstream response.
      await reader.cancel().catch(() => {});
    }
    this.noteServed({ model: call.servedModel }, model, call, request.trace);
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
    const body = { model, messages, max_tokens: IMAGE_ANALYSIS_MAX_OUTPUT_TOKENS, stream: false };
    const { res, call } = await this.post(body, { kind: "vision", model, request });
    const json = await readJsonBody<OpenRouterResponse>(res, "OpenRouter image analysis", this.id, model);
    this.checkBody(json, model);
    if (json.id) request.trace?.responseIds.push(json.id);
    this.noteServed(json, model, call, request.trace);
    const text = json.choices?.[0]?.message?.content;
    // An empty analysis is not a provider outage and not a reason to switch providers.
    if (typeof text !== "string" || !text.trim()) throw new Error("OpenRouter returned an empty image analysis");
    return { text: text.trim() };
  }

  /**
   * One logical request with the shared retry policy. A network failure and a transient 5xx get
   * a bounded backoff; a daily quota, an empty balance, or any other failure ends the call.
   */
  private async post(
    body: unknown,
    context: { kind: ModelCallRecord["kind"]; model: string; request: Pick<AIRequest, "signal" | "trace" | "modelCallId">; stream?: boolean },
  ): Promise<{ res: Response; call: ModelCallRecord }> {
    const { model, request } = context;
    const call = beginModelCall(context.kind, model, request.modelCallId, this.id);
    const key = this.key();
    const url = `${(this.options.baseUrl ?? DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, "")}/chat/completions`;
    const payload = JSON.stringify(body);
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let lastError: Error | undefined;

    for (let attempt = 0; ; attempt += 1) {
      if (request.signal?.aborted) throw abortError();
      if (request.trace) request.trace.httpRequests += 1;
      call.httpRequests += 1;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
            "http-referer": APP_REFERER,
            "x-title": APP_TITLE,
            ...(context.stream ? { accept: "text/event-stream" } : {}),
          },
          body: payload,
          signal: request.signal ? AbortSignal.any([controller.signal, request.signal]) : controller.signal,
        });
      } catch (error) {
        if (request.signal?.aborted) throw abortError();
        if (isAbortError(error)) {
          const timedOut = timeoutError("OpenRouter request", this.id, model);
          call.failure = { code: timedOut.code, model };
          throw timedOut;
        }
        if (!isTransportError(error)) throw error;
        lastError = transportFailure(LABEL, this.id, error, model);
        call.failure = { code: "AI_UNAVAILABLE", model };
        const wait = retryDelayMs({ kind: "transient" }, attempt);
        if (wait === null) throw lastError;
        await sleep(wait, request.signal);
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        call.servedModel = model;
        call.outcome = "ok";
        request.trace?.servedModels?.push(model);
        return { res, call };
      }

      call.status = res.status;
      const text = await res.text().catch(() => "");
      const failure: ProviderFailure = classifyOpenRouterFailure(res.status, text, res.headers.get("retry-after"));
      const providerError = toOpenRouterError(LABEL, res.status, res.statusText, failure, text, model);
      lastError = providerError;
      call.failure = { code: providerError.code, quotaType: providerError.quotaType, ...providerError.evidence };
      const wait = retryDelayMs(failure, attempt);
      if (wait === null) throw lastError;
      await sleep(wait, request.signal);
    }
  }

  /** A 2xx whose body is an error or has no usable choice is a provider failure, not an answer. */
  private checkBody(json: OpenRouterResponse, model: string): void {
    if (json.error) throw openRouterBodyError(LABEL, json.error, model);
    const choice = json.choices?.[0];
    if (choice?.error) throw openRouterBodyError(LABEL, choice.error, model);
    if (!choice) throw unreadableResponse(LABEL, this.id, model);
  }

  private noteServed(json: OpenRouterResponse, model: string, call: ModelCallRecord, trace?: ProviderTrace): void {
    const served = json.model || model;
    call.servedModel = served;
    // `servedModels` already holds the requested model from post(); replace it by the real one.
    const models = trace?.servedModels;
    if (models && models[models.length - 1] === model && served !== model) models[models.length - 1] = served;
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
      usage: { promptTokens: json.usage?.prompt_tokens ?? 0, completionTokens: json.usage?.completion_tokens ?? 0 },
    };
  }
}

// ---- request translation -------------------------------------------------------------------------

/**
 * Builds the Chat Completions body. `names` maps the tool names sent to OpenRouter back to skill
 * ids: skill ids contain a dot (`web.search`), which the OpenAI-style function-name pattern
 * (`[A-Za-z0-9_-]`) does not allow.
 */
export function buildChatBody(request: AIRequest, stream: boolean): { body: Record<string, unknown>; names?: Map<string, string> } {
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

  const body: Record<string, unknown> = {
    model: request.modelConfig.model,
    messages,
    stream,
    max_tokens: request.modelConfig.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
  if (request.modelConfig.temperature !== undefined) body.temperature = request.modelConfig.temperature;

  let names: Map<string, string> | undefined;
  if (request.tools && request.tools.length > 0) {
    const encoded = encodeTools(request.tools);
    body.tools = encoded.tools;
    names = encoded.names;
  }
  if (request.responseFormat === "json") body.response_format = { type: "json_object" };
  // Without this OpenRouter may pick an endpoint that ignores tools or response_format.
  if (names || request.responseFormat) body.provider = { require_parameters: true };
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
