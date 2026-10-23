import { afterEach, describe, expect, it, vi } from "vitest";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import { GeminiProvider } from "../../src/ai/geminiProvider.js";
import { analyzeImageWithGemini } from "../../src/ai/geminiVision.js";
import type { AIRequest } from "../../src/ai/provider.js";
import { GeminiSearchProvider } from "../../src/skills/webSearch.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const request: AIRequest = {
  systemPrompt: "You are ZARVIS.",
  messages: [{ role: "user", content: "hello" }],
  modelConfig: { provider: "google", model: "gemini-3.6-flash" },
};
const sse = (text: string) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;

/**
 * A 200 whose body never arrives. Like Node's fetch, the body fails with an AbortError once the
 * request's signal is aborted, and only then.
 */
function stalledAfterHeaders(_url: string, init?: RequestInit): Promise<Response> {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      init?.signal?.addEventListener("abort", () => controller.error(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })));
    },
  });
  return Promise.resolve(new Response(body, { status: 200 }));
}

/** What `promise` has settled to after the fake clock moved `ms`; "pending" when it has not settled. */
async function after<T>(ms: number, promise: Promise<T>): Promise<unknown> {
  const settled = promise.then((value) => ({ value }), (error: unknown) => ({ error }));
  await vi.advanceTimersByTimeAsync(ms);
  return Promise.race([settled, new Promise((resolve) => setImmediate(() => resolve("pending")))]);
}

describe("Gemini: the time limit covers the answer's body, not only its headers", () => {
  it("a generate whose body stalls after a 200 ends as a structured timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn(stalledAfterHeaders));

    const outcome = await after(90_001, new GeminiProvider("k").generate(request));

    expect(outcome).not.toBe("pending");
    const failure = (outcome as { error: unknown }).error;
    expect(failure).toBeInstanceOf(AIProviderError);
    expect(failure).toMatchObject({ kind: "AI_PROVIDER_TIMEOUT", message: "Gemini request timed out", provider: "google" });
  });

  it("a stream that goes quiet mid-answer ends as a structured timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const encoder = new TextEncoder();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode(sse("one "))); } }), { status: 200 })));

    const seen: string[] = [];
    const consume = (async () => {
      for await (const chunk of new GeminiProvider("k").streamGenerate(request)) seen.push(chunk.delta);
    })();

    const outcome = await after(30_001, consume);

    expect(seen).toEqual(["one "]);
    expect(outcome).not.toBe("pending");
    expect((outcome as { error: unknown }).error).toMatchObject({ kind: "AI_PROVIDER_TIMEOUT", provider: "google" });
  });

  it("an image analysis whose body stalls ends as a structured timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn(stalledAfterHeaders));

    const outcome = await after(60_001, analyzeImageWithGemini(Buffer.from("png"), "image/png", { apiKey: "k", models: ["gemini-3.6-flash"] }));

    expect(outcome).not.toBe("pending");
    expect((outcome as { error: unknown }).error).toMatchObject({ kind: "AI_PROVIDER_TIMEOUT" });
  });

  it("a Google Search grounding call whose body stalls ends as a structured timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn(stalledAfterHeaders));

    const outcome = await after(60_001, new GeminiSearchProvider("k").search("weather in Patna"));

    expect(outcome).not.toBe("pending");
    expect((outcome as { error: unknown }).error).toMatchObject({ kind: "AI_PROVIDER_TIMEOUT" });
  });
});
