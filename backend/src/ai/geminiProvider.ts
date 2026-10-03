import { randomUUID } from "node:crypto";
import { abortError, classifyGeminiFailure, retryDelayMs, shouldTryNextModel, sleep, toProviderError } from "./geminiErrors.js";
import { logger } from "../security/redact.js";
import { beginModelCall } from "./callTrace.js";
import type {
  AIProvider,
  AIRequest,
  AIResponse,
  AIResponseChunk,
  ConversationMessage,
  ToolDefinition,
} from "./provider.js";

/**
 * Real [AIProvider] adapter for Google Gemini — see AI_ARCHITECTURE.md "Provider
 * abstraction" and MASTER_SPEC.md §10. This is the first non-mock provider wired into this
 * repository: it is registered under `id: "google"` in providerFactory.ts and selected
 * automatically as the default model config whenever `GEMINI_API_KEY` is configured
 * (config/env.ts), so setting that one environment variable is enough to move the whole
 * tool-calling loop off the deterministic [MockAIProvider] onto a real model — no caller
 * changes required (the point of the provider-agnostic contract in provider.ts).
 *
 * Uses the public Generative Language REST API directly via the platform `fetch` (Node 20+
 * ships it globally) rather than adding a vendor SDK dependency, keeping the adapter a thin,
 * auditable translation layer between our provider-agnostic types and Gemini's wire format.
 */
export class GeminiProvider implements AIProvider {
  readonly id = "google";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta",
  ) {}

  async generate(request: AIRequest): Promise<AIResponse> {
    const res = await this.send(request, "generateContent", "Gemini generateContent", 90_000);
    const json = (await res.json()) as GeminiGenerateResponse;
    if (json.responseId) request.trace?.responseIds.push(json.responseId);
    return fromGeminiResponse(json);
  }

  async *streamGenerate(request: AIRequest): AsyncIterable<AIResponseChunk> {
    // Retries happen only inside send(), i.e. before any byte of the stream was read, so an
    // already-rendered reply is never duplicated.
    const res = await this.send(request, "streamGenerateContent?alt=sse", "Gemini streamGenerateContent", 120_000);
    if (!res.body) throw new Error("Gemini streamGenerateContent returned no body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice("data:".length).trim();
          if (!payload || payload === "[DONE]") continue;
          const chunk = JSON.parse(payload) as GeminiGenerateResponse;
          const text = extractText(chunk);
          if (text) yield { delta: text, done: false };
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { delta: "", done: true };
  }

  /**
   * Sends one logical request. Retries follow ai/geminiErrors.ts: a daily quota fails at once
   * (no retry, no fallback model), a short per-minute limit is retried once, transient 5xx
   * errors get a bounded backoff and may move to the fallback model.
   */
  private async send(request: AIRequest, method: string, label: string, timeoutMs: number): Promise<Response> {
    const models = [request.modelConfig.model, FALLBACK_MODEL].filter(
      (model, index, all) => model && all.indexOf(model) === index,
    );
    const body = JSON.stringify(toGeminiRequestBody(request));
    let lastError: Error | undefined;
    const call = beginModelCall(request.purpose ?? "planner", request.modelConfig.model, request.modelCallId);

    for (const model of models) {
      for (let attempt = 0; ; attempt += 1) {
        if (request.signal?.aborted) throw abortError();
        if (request.trace) request.trace.httpRequests += 1;
        call.httpRequests += 1;
        const res = await fetchWithTimeout(
          `${this.baseUrl}/models/${encodeURIComponent(model)}:${method}`,
          { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey }, body },
          timeoutMs,
          request.signal,
        );
        if (res.ok) {
          request.trace?.servedModels?.push(model);
          call.servedModel = model;
          call.outcome = "ok";
          if (model !== request.modelConfig.model) {
            logger.warn("Gemini answered with the fallback model", {
              modelCallId: call.modelCallId,
              configuredModel: request.modelConfig.model,
              servedModel: model,
              label,
            });
          }
          return res;
        }
        call.status = res.status;

        const text = await res.text().catch(() => "");
        const failure = classifyGeminiFailure(res.status, text, res.headers.get("retry-after"));
        lastError = toProviderError(label, res.status, res.statusText, failure, text);
        if (failure.kind === "fatal") throw lastError;
        const wait = retryDelayMs(failure, attempt);
        if (wait === null) {
          if (!shouldTryNextModel(failure)) throw lastError;
          break;
        }
        await sleep(wait, request.signal);
      }
    }

    throw lastError ?? new Error(`${label} failed without a response`);
  }
}

/** Used when the configured model is unavailable (404) or overloaded (5xx). */
const FALLBACK_MODEL = "gemini-3.8-flash";

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: { type: "OBJECT"; properties: Record<string, { type: string }>; required: string[] };
}

interface GeminiRequestBody {
  systemInstruction?: { parts: [{ text: string }] };
  contents: GeminiContent[];
  tools?: [{ functionDeclarations: GeminiFunctionDeclaration[] }];
  generationConfig?: { temperature?: number; maxOutputTokens?: number };
}

interface GeminiGenerateResponse {
  responseId?: string;
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

function toGeminiRequestBody(request: AIRequest): GeminiRequestBody {
  return {
    systemInstruction: request.systemPrompt ? { parts: [{ text: request.systemPrompt }] } : undefined,
    contents: request.messages.filter((m) => m.role !== "system").map(toGeminiContent),
    tools: request.tools && request.tools.length > 0 ? [{ functionDeclarations: request.tools.map(toFunctionDeclaration) }] : undefined,
    generationConfig: {
      temperature: request.modelConfig.temperature,
      maxOutputTokens: request.modelConfig.maxTokens,
    },
  };
}

/**
 * Gemini only has `user`/`model` roles. Our provider-agnostic `ConversationMessage` has no
 * structured tool-result shape (see provider.ts), so a `tool` message — the result of a
 * skill execution fed back to the model — is passed through as a labelled `user` turn
 * rather than Gemini's richer `functionResponse` part. This is a deliberate simplification
 * consistent with MockAIProvider's equally flat message model; a future upgrade path is to
 * extend `ConversationMessage` with a structured tool-result variant used by every adapter.
 */
function toGeminiContent(message: ConversationMessage): GeminiContent {
  if (message.role === "assistant") {
    return { role: "model", parts: [{ text: message.content }] };
  }
  if (message.role === "tool") {
    return { role: "user", parts: [{ text: `[Tool result] ${message.content}` }] };
  }
  return { role: "user", parts: [{ text: message.content }] };
}

function toFunctionDeclaration(tool: ToolDefinition): GeminiFunctionDeclaration {
  const properties: Record<string, { type: string }> = {};
  for (const [field, type] of Object.entries(tool.inputSchema.properties ?? {})) {
    properties[field] = { type: toGeminiType(type) };
  }
  for (const field of tool.inputSchema.requiredFields) {
    if (!properties[field]) properties[field] = { type: "STRING" };
  }
  return {
    name: tool.name,
    description: tool.description,
    parameters: { type: "OBJECT", properties, required: tool.inputSchema.requiredFields },
  };
}

function toGeminiType(jsonSchemaType: string): string {
  switch (jsonSchemaType.toLowerCase()) {
    case "number":
      return "NUMBER";
    case "integer":
      return "INTEGER";
    case "boolean":
      return "BOOLEAN";
    case "array":
      return "ARRAY";
    case "object":
      return "OBJECT";
    default:
      return "STRING";
  }
}

function fromGeminiResponse(json: GeminiGenerateResponse): AIResponse {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("");
  const toolCalls = parts
    .filter((p): p is GeminiPart & { functionCall: NonNullable<GeminiPart["functionCall"]> } => !!p.functionCall)
    .map((p) => ({ id: randomUUID(), skillId: p.functionCall.name, input: p.functionCall.args ?? {} }));

  return {
    message: { role: "assistant", content: text },
    toolCalls,
    usage: {
      promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

function extractText(chunk: GeminiGenerateResponse): string {
  const parts = chunk.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
}


async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
  cancel?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = cancel ? AbortSignal.any([controller.signal, cancel]) : controller.signal;
  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (cancel?.aborted) throw abortError();
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Gemini request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
