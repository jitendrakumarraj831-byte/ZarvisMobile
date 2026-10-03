import { vi } from "vitest";
import type { GatewayEnvironment } from "../../src/ai/providerFactory.js";
import type { AIRequest } from "../../src/ai/provider.js";

/**
 * Shared test harness for everything that goes through the AI Model Gateway. The REAL providers
 * run (GeminiProvider, OpenRouterProvider, the real retry policy); only `fetch` is stubbed, and
 * every outgoing call is recorded with its host, so a test can assert exactly how many provider
 * requests a user turn caused and where each one went.
 */

export const GEMINI_KEY = "gemini-test-key-AAAA1111";
export const OPENROUTER_KEY = "sk-or-v1-testkeyBBBB2222cccc3333dddd";

export function fakeEnv(overrides: Partial<GatewayEnvironment> = {}): GatewayEnvironment {
  return {
    geminiApiKey: GEMINI_KEY,
    geminiModel: "gemini-3.6-flash",
    openRouterApiKey: OPENROUTER_KEY,
    openRouterBaseUrl: undefined,
    openRouterModel: undefined,
    openRouterModelCapabilities: undefined,
    openRouterModelContextTokens: undefined,
    openRouterTimeoutMs: undefined,
    aiPrimaryProvider: undefined,
    aiFallbackProvider: undefined,
    aiModelCatalogJson: undefined,
    aiQuotaCooldownMs: undefined,
    ...overrides,
  };
}

export interface RecordedCall {
  url: string;
  host: "gemini" | "openrouter" | "other";
  method: string;
  headers: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  signal?: AbortSignal | null;
}

export type Responder = (call: RecordedCall) => Response | Promise<Response>;

/** Answers calls in order; the last responder answers every call after that. */
export function sequence(...responders: Responder[]): Responder {
  let index = 0;
  return (call) => {
    const responder = responders[Math.min(index, responders.length - 1)]!;
    index += 1;
    return responder(call);
  };
}

export interface ProviderStub {
  calls: RecordedCall[];
  gemini: RecordedCall[];
  openrouter: RecordedCall[];
}

/** The request's host name, parsed (never matched as a substring, so a look-alike URL cannot pass for a provider). */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Routes `fetch` by provider host. A host with no responder fails the test: nothing may reach it. */
export function stubProviders(handlers: { gemini?: Responder; openrouter?: Responder }, extraOpenRouterHosts: string[] = []): ProviderStub {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const hostname = hostnameOf(url);
      const host: RecordedCall["host"] =
        hostname === "generativelanguage.googleapis.com"
          ? "gemini"
          : hostname === "openrouter.ai" || extraOpenRouterHosts.includes(hostname)
            ? "openrouter"
            : "other";
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[name.toLowerCase()] = value;
      const call: RecordedCall = { url, host, method: init?.method ?? "GET", headers, body: init?.body ? JSON.parse(String(init.body)) : undefined, signal: init?.signal };
      calls.push(call);
      const responder = host === "gemini" ? handlers.gemini : host === "openrouter" ? handlers.openrouter : undefined;
      if (!responder) throw new Error(`unexpected request to ${host}: ${url}`);
      return responder(call);
    }),
  );
  return {
    calls,
    get gemini() {
      return calls.filter((call) => call.host === "gemini");
    },
    get openrouter() {
      return calls.filter((call) => call.host === "openrouter");
    },
  };
}

// ---- Gemini responses ---------------------------------------------------------------------------

export const geminiText =
  (text: string): Responder =>
  () =>
    new Response(JSON.stringify({ responseId: "gem-resp-1", candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } }), { status: 200 });

export const geminiCall =
  (name: string, args: Record<string, unknown>): Responder =>
  () =>
    new Response(JSON.stringify({ responseId: "gem-resp-2", candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] }), { status: 200 });

export const geminiFail =
  (status: number, body = ""): Responder =>
  () =>
    new Response(body, { status, statusText: status === 429 ? "Too Many Requests" : status === 503 ? "Service Unavailable" : "Error" });

// ---- OpenRouter responses -----------------------------------------------------------------------

export const openRouterText =
  (text: string, model = "vendor/served-free-model:free"): Responder =>
  () =>
    new Response(
      JSON.stringify({ id: "gen-or-1", model, choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 4 } }),
      { status: 200 },
    );

export const openRouterCall =
  (name: string, args: unknown, id = "call_1"): Responder =>
  () =>
    new Response(
      JSON.stringify({
        id: "gen-or-2",
        model: "vendor/served-tool-model",
        choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } }] }, finish_reason: "tool_calls" }],
      }),
      { status: 200 },
    );

export const openRouterFail =
  (status: number, message: string, metadata?: Record<string, unknown>): Responder =>
  () =>
    new Response(JSON.stringify({ error: { code: status, message, ...(metadata ? { metadata } : {}) } }), { status, statusText: status === 429 ? "Too Many Requests" : "Error" });

// ---- streams ------------------------------------------------------------------------------------

export function sseResponse(events: string[], options: { failAfter?: Error; onCancel?: () => void } = {}): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < events.length) {
        controller.enqueue(encoder.encode(events[index]));
        index += 1;
        return;
      }
      if (options.failAfter) controller.error(options.failAfter);
      else controller.close();
    },
    cancel() {
      options.onCancel?.();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

export const geminiSse = (text: string) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;
export const openRouterSse = (text: string, model?: string) => `data: ${JSON.stringify({ id: "gen-s", ...(model ? { model } : {}), choices: [{ delta: { content: text } }] })}\n\n`;

// ---- requests -----------------------------------------------------------------------------------

export function chatRequest(overrides: Partial<AIRequest> = {}): AIRequest {
  return {
    systemPrompt: "You are ZARVIS.",
    messages: [{ role: "user", content: "write one line about rivers" }],
    modelConfig: { provider: "gateway", model: "ignored-by-routing" },
    purpose: "generation",
    ...overrides,
  };
}

export const searchTool = {
  name: "web.search",
  description: "Search the live web",
  inputSchema: { requiredFields: ["query"], properties: { query: "string" } },
};
