import { randomUUID } from "node:crypto";
import { abortError, AIProviderError, sleep } from "./geminiErrors.js";
import { beginModelCall } from "./callTrace.js";
import type { AIProvider, AIRequest, AIResponse, AIResponseChunk, ConversationMessage, ToolDefinition } from "./provider.js";

/**
 * [AIProvider] adapter for OpenRouter (OpenAI-compatible chat completions). Used as the
 * fallback behind Gemini (see fallbackProvider.ts), or on its own when only
 * `OPENROUTER_API_KEY` is configured. `request.modelConfig.model` is the OpenRouter model id
 * (e.g. `google/gemini-2.0-flash-001`, `openrouter/auto`).
 */
export class OpenRouterProvider implements AIProvider {
  readonly id = "openrouter";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://openrouter.ai/api/v1",
  ) {}

  async generate(request: AIRequest): Promise<AIResponse> {
    const res = await this.send(request, false, 90_000);
    const json = (await res.json()) as ChatCompletionResponse;
    if (json.id) request.trace?.responseIds.push(json.id);
    const message = json.choices?.[0]?.message;
    const toolCalls = (message?.tool_calls ?? []).map((call) => ({
      id: call.id || randomUUID(),
      skillId: call.function.name,
      input: parseArguments(call.function.arguments),
    }));
    return {
      message: { role: "assistant", content: message?.content ?? "" },
      toolCalls,
      usage: { promptTokens: json.usage?.prompt_tokens ?? 0, completionTokens: json.usage?.completion_tokens ?? 0 },
    };
  }

  async *streamGenerate(request: AIRequest): AsyncIterable<AIResponseChunk> {
    const res = await this.send(request, true, 120_000);
    if (!res.body) throw new Error("OpenRouter stream returned no body");
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
          // Lines starting with ":" are OpenRouter keep-alive comments.
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice("data:".length).trim();
          if (!payload || payload === "[DONE]") continue;
          let chunk: ChatCompletionChunk;
          try {
            chunk = JSON.parse(payload) as ChatCompletionChunk;
          } catch {
            continue;
          }
          if (chunk.error) throw new Error(`OpenRouter stream error: ${chunk.error.message ?? "unknown"}`);
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) yield { delta: text, done: false };
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { delta: "", done: true };
  }

  /** One logical request with a small bounded retry on 429/5xx. */
  private async send(request: AIRequest, stream: boolean, timeoutMs: number): Promise<Response> {
    const call = beginModelCall(request.purpose ?? "planner", request.modelConfig.model, request.modelCallId);
    const body = JSON.stringify(toChatBody(request, stream));
    let lastError: AIProviderError | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (request.signal?.aborted) throw abortError();
      if (request.trace) request.trace.httpRequests += 1;
      call.httpRequests += 1;
      const res = await fetchWithTimeout(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
            "x-title": "ZARVIS",
          },
          body,
        },
        timeoutMs,
        request.signal,
      );
      if (res.ok) {
        request.trace?.servedModels?.push(request.modelConfig.model);
        call.servedModel = request.modelConfig.model;
        call.outcome = "ok";
        return res;
      }
      call.status = res.status;
      const text = await res.text().catch(() => "");
      lastError = toError(res.status, res.statusText, text, request.modelConfig.model);
      call.failure = { code: lastError.code, model: request.modelConfig.model };
      if (!lastError.retryable || attempt === 1) break;
      await sleep(lastError.retryAfterMs ?? 1000, request.signal);
    }
    throw lastError ?? new Error("OpenRouter request failed without a response");
  }
}

interface ChatToolCall {
  id?: string;
  function: { name: string; arguments?: string };
}

interface ChatCompletionResponse {
  id?: string;
  choices?: Array<{ message?: { content?: string | null; tool_calls?: ChatToolCall[] } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface ChatCompletionChunk {
  choices?: Array<{ delta?: { content?: string | null } }>;
  error?: { message?: string };
}

function toChatBody(request: AIRequest, stream: boolean) {
  const messages: Array<{ role: string; content: string }> = [];
  if (request.systemPrompt) messages.push({ role: "system", content: request.systemPrompt });
  for (const message of request.messages) {
    if (message.role === "system") continue;
    messages.push(toChatMessage(message));
  }
  return {
    model: request.modelConfig.model,
    messages,
    stream,
    temperature: request.modelConfig.temperature,
    max_tokens: request.modelConfig.maxTokens,
    tools: request.tools && request.tools.length > 0 ? request.tools.map(toChatTool) : undefined,
  };
}

/** Same simplification as GeminiProvider: tool results go back as labelled user turns. */
function toChatMessage(message: ConversationMessage): { role: string; content: string } {
  if (message.role === "tool") return { role: "user", content: `[Tool result] ${message.content}` };
  return { role: message.role, content: message.content };
}

function toChatTool(tool: ToolDefinition) {
  const properties: Record<string, { type: string }> = {};
  for (const [field, type] of Object.entries(tool.inputSchema.properties ?? {})) {
    properties[field] = { type: String(type).toLowerCase() };
  }
  for (const field of tool.inputSchema.requiredFields) {
    if (!properties[field]) properties[field] = { type: "string" };
  }
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: { type: "object", properties, required: tool.inputSchema.requiredFields },
    },
  };
}

function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toError(status: number, statusText: string, bodyText: string, model: string): AIProviderError {
  const message = `OpenRouter chat completion failed: ${status} ${statusText} ${bodyText.slice(0, 300)}`.trim();
  if (status === 429) return new AIProviderError(message, "AI_RATE_LIMITED", status, true, undefined, "unknown", { model });
  if (status === 402) return new AIProviderError(message, "AI_QUOTA_EXCEEDED", status, false, undefined, "daily", { model });
  const transient = status === 408 || status >= 500;
  return new AIProviderError(message, "AI_UNAVAILABLE", status, transient, undefined, undefined, { model });
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number, cancel?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = cancel ? AbortSignal.any([controller.signal, cancel]) : controller.signal;
  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (cancel?.aborted) throw abortError();
    if (error instanceof Error && error.name === "AbortError") throw new Error("OpenRouter request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
