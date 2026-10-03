import { afterEach, describe, expect, it, vi } from "vitest";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import type { AIResponseChunk } from "../../src/ai/provider.js";
import { createModelGateway } from "../../src/ai/providerFactory.js";
import { DAILY, quotaBody } from "./geminiFixtures.js";
import {
  chatRequest,
  fakeEnv,
  geminiFail,
  geminiSse,
  geminiText,
  openRouterFail,
  openRouterSse,
  openRouterText,
  searchTool,
  sseResponse,
  stubProviders,
} from "./gatewayHarness.js";

vi.mock("../../src/ai/geminiErrors.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/ai/geminiErrors.js")>()),
  sleep: async () => {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const gatewayFor = (envOverrides: Parameters<typeof fakeEnv>[0] = {}) => createModelGateway(fakeEnv(envOverrides), { isProduction: true });
const error = async (promise: Promise<unknown>) => (await promise.then(() => undefined, (e: unknown) => e)) as AIProviderError;

async function collect(stream: AsyncIterable<AIResponseChunk>): Promise<AIResponseChunk[]> {
  const chunks: AIResponseChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe("ModelGateway streaming", () => {
  it("streams Gemini text incrementally and ends with ONE final chunk that says who answered", async () => {
    const stub = stubProviders({ gemini: () => sseResponse([geminiSse("Hello "), geminiSse("world")]) });
    const chunks = await collect(gatewayFor().streamText(chatRequest()));

    expect(chunks.filter((chunk) => !chunk.done).map((chunk) => chunk.delta)).toEqual(["Hello ", "world"]);
    expect(chunks.filter((chunk) => chunk.done)).toHaveLength(1);
    expect(chunks.at(-1)?.meta).toMatchObject({ provider: "google", fallback: false });
    expect(stub.gemini).toHaveLength(1);
    expect(stub.gemini[0]!.url).toContain(":streamGenerateContent?alt=sse");
    expect(stub.openrouter).toHaveLength(0);
  });

  it("fails over before the first chunk: OpenRouter streams the whole answer, comments and [DONE] handled", async () => {
    const stub = stubProviders({
      gemini: geminiFail(429, quotaBody(DAILY)),
      openrouter: () =>
        sseResponse([": OPENROUTER PROCESSING\n\n", openRouterSse("Fall", "vendor/streaming-model:free"), openRouterSse("back"), `data: ${JSON.stringify({ id: "gen-s", choices: [], usage: { prompt_tokens: 3 } })}\n\n`, "data: [DONE]\n\n"]),
    });
    const chunks = await collect(gatewayFor().streamText(chatRequest()));

    expect(chunks.filter((chunk) => !chunk.done).map((chunk) => chunk.delta).join("")).toBe("Fallback");
    expect(chunks.at(-1)).toMatchObject({ done: true, meta: { provider: "openrouter", model: "vendor/streaming-model:free", fallback: true, fallbackReason: "GEMINI_QUOTA_EXCEEDED" } });
    expect(stub.gemini).toHaveLength(1);
    expect(stub.openrouter).toHaveLength(1);
    expect(stub.openrouter[0]!.body).toMatchObject({ stream: true });
  });

  it("never switches providers once text was delivered: the answer is not restarted or mixed", async () => {
    const stub = stubProviders({
      gemini: () => sseResponse([geminiSse("Part one. ")], { failAfter: new TypeError("terminated") }),
      openrouter: openRouterText("must not run"),
    });
    const seen: string[] = [];
    const failure = await error(
      (async () => {
        for await (const chunk of gatewayFor().streamText(chatRequest())) seen.push(chunk.delta);
      })(),
    );

    expect(seen).toEqual(["Part one. "]);
    expect(failure).toBeInstanceOf(AIProviderError);
    expect(failure.kind).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(stub.openrouter).toHaveLength(0);
  });

  it("a stream that fails mid-way with a cancellation is a cancellation, not a provider failure", async () => {
    const stub = stubProviders({
      gemini: () => sseResponse([geminiSse("Start. ")], { failAfter: Object.assign(new Error("aborted"), { name: "AbortError" }) }),
      openrouter: openRouterText("must not run"),
    });
    const failure = await error(collect(gatewayFor().streamText(chatRequest())));

    expect(failure.name).toBe("AbortError");
    expect(stub.openrouter).toHaveLength(0);
  });

  it("when the consumer stops early (disconnect), the upstream response is cancelled", async () => {
    let cancelled = false;
    stubProviders({ gemini: () => sseResponse([geminiSse("one "), geminiSse("two "), geminiSse("three")], { onCancel: () => (cancelled = true) }) });
    const iterator = gatewayFor().streamText(chatRequest())[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value).toMatchObject({ delta: "one ", done: false });
    await iterator.return?.();

    expect(cancelled).toBe(true);
  });

  it("the same early stop cancels an OpenRouter stream", async () => {
    let cancelled = false;
    stubProviders({ openrouter: () => sseResponse([openRouterSse("a "), openRouterSse("b "), openRouterSse("c")], { onCancel: () => (cancelled = true) }) });
    const iterator = gatewayFor({ geminiApiKey: undefined }).streamText(chatRequest())[Symbol.asyncIterator]();

    await iterator.next();
    await iterator.return?.();

    expect(cancelled).toBe(true);
  });

  it("an error event inside an OpenRouter stream before any text fails over to Gemini", async () => {
    const stub = stubProviders({
      openrouter: () => sseResponse([`data: ${JSON.stringify({ error: { code: 503, message: "provider disconnected" } })}\n\n`]),
      gemini: () => sseResponse([geminiSse("Gemini continues.")]),
    });
    const chunks = await collect(gatewayFor({ aiPrimaryProvider: "openrouter" }).streamText(chatRequest()));

    expect(chunks.map((chunk) => chunk.delta).join("")).toBe("Gemini continues.");
    expect(chunks.at(-1)?.meta).toMatchObject({ provider: "google", fallback: true, fallbackReason: "OPENROUTER_UNAVAILABLE" });
    expect(stub.openrouter).toHaveLength(1);
  });

  it("refuses a streamed request that carries tools: tool calls would be lost, not run", async () => {
    const stub = stubProviders({ gemini: geminiText("x"), openrouter: openRouterText("y") });
    const failure = await error(collect(gatewayFor().streamGenerate(chatRequest({ tools: [searchTool] }))));

    expect(failure.kind).toBe("AI_PROVIDER_CAPABILITY_UNSUPPORTED");
    expect(stub.calls).toHaveLength(0);
  });

  it("a fallback model that does not declare streaming is not used for a stream", async () => {
    const catalog = JSON.stringify([{ provider: "openrouter", model: "vendor/no-stream:free" }]);
    const stub = stubProviders({ gemini: geminiFail(429, quotaBody(DAILY)), openrouter: openRouterText("must not run") });
    const failure = await error(collect(gatewayFor({ aiModelCatalogJson: catalog }).streamText(chatRequest())));

    expect(failure.code).toBe("AI_QUOTA_EXCEEDED");
    expect(stub.openrouter).toHaveLength(0);
  });
});

// ---- image analysis ----------------------------------------------------------------------------

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("ModelGateway image analysis", () => {
  it("analyzes an image with Gemini and sends the image itself, with its MIME type", async () => {
    const stub = stubProviders({ gemini: geminiText("A red car.") });
    const result = await gatewayFor().analyzeImage({ data: PNG, mimeType: "image/png" });

    expect(result.text).toBe("A red car.");
    expect(result.meta).toMatchObject({ provider: "google", fallback: false });
    const parts = stub.gemini[0]!.body.contents[0].parts;
    expect(parts[1].inlineData).toEqual({ mimeType: "image/png", data: PNG.toString("base64") });
    expect(stub.openrouter).toHaveLength(0);
  });

  it("falls back to a vision-capable OpenRouter model when Gemini is out of quota", async () => {
    const stub = stubProviders({ gemini: geminiFail(429, quotaBody(DAILY)), openrouter: openRouterText("A red car (OpenRouter).") });
    const result = await gatewayFor({ openRouterModelCapabilities: "vision" }).analyzeImage({ data: PNG, mimeType: "image/png" });

    expect(result.text).toBe("A red car (OpenRouter).");
    expect(result.meta).toMatchObject({ provider: "openrouter", fallback: true, fallbackReason: "GEMINI_QUOTA_EXCEEDED" });
    const content = stub.openrouter[0]!.body.messages[1].content;
    expect(content[0]).toMatchObject({ type: "text" });
    expect(content[1].image_url.url).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
  });

  it("never sends an image to a model that does not declare vision: the upload is not silently dropped", async () => {
    const stub = stubProviders({ gemini: geminiFail(429, quotaBody(DAILY)), openrouter: openRouterText("must not run") });
    const failure = await error(gatewayFor().analyzeImage({ data: PNG, mimeType: "image/png" }));

    expect(failure).toMatchObject({ code: "AI_QUOTA_EXCEEDED" }); // the real cause, not a fake description
    expect(stub.openrouter).toHaveLength(0);
  });

  it("an image type the fallback model does not accept (HEIC) is not routed there", async () => {
    const stub = stubProviders({ gemini: geminiFail(429, quotaBody(DAILY)), openrouter: openRouterText("must not run") });
    const failure = await error(gatewayFor({ openRouterModelCapabilities: "vision" }).analyzeImage({ data: PNG, mimeType: "image/heic" }));

    expect(failure.code).toBe("AI_QUOTA_EXCEEDED");
    expect(stub.openrouter).toHaveLength(0);
  });

  it("a provider rejecting the image itself (400) or the key (403) does not fall back", async () => {
    for (const [status, kind] of [[400, "AI_PROVIDER_INVALID_REQUEST"], [403, "AI_PROVIDER_AUTH_ERROR"]] as const) {
      const stub = stubProviders({ gemini: geminiFail(status, JSON.stringify({ error: { message: "no" } })), openrouter: openRouterText("must not run") });
      const failure = await error(gatewayFor({ openRouterModelCapabilities: "vision" }).analyzeImage({ data: PNG, mimeType: "image/png" }));
      expect(failure.kind).toBe(kind);
      expect(stub.gemini).toHaveLength(1);
      expect(stub.openrouter).toHaveLength(0);
    }
  });

  it("an empty analysis is not a provider outage: no fallback, and it is not reported as an AI failure", async () => {
    const stub = stubProviders({ gemini: () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "  " }] } }] }), { status: 200 }), openrouter: openRouterText("must not run") });
    const failure = await error(gatewayFor({ openRouterModelCapabilities: "vision" }).analyzeImage({ data: PNG, mimeType: "image/png" }));

    expect(failure).not.toBeInstanceOf(AIProviderError);
    expect(failure.message).toMatch(/empty image analysis/);
    expect(stub.openrouter).toHaveLength(0);
  });

  it("no configured model can read images: a structured capability error and no request", async () => {
    const stub = stubProviders({ openrouter: openRouterText("must not run") });
    const gateway = gatewayFor({ geminiApiKey: undefined });
    const failure = await error(gateway.analyzeImage({ data: PNG, mimeType: "image/png" }));

    expect(failure.kind).toBe("AI_PROVIDER_CAPABILITY_UNSUPPORTED");
    expect(stub.calls).toHaveLength(0);
  });

  it("canAnalyzeImage follows the configured providers and the image type", () => {
    expect(gatewayFor().canAnalyzeImage("image/heic")).toBe(true); // Gemini
    expect(gatewayFor({ geminiApiKey: undefined }).canAnalyzeImage("image/png")).toBe(false); // OpenRouter, no vision declared
    const visionOnly = gatewayFor({ geminiApiKey: undefined, openRouterModelCapabilities: "vision" });
    expect(visionOnly.canAnalyzeImage("image/png")).toBe(true);
    expect(visionOnly.canAnalyzeImage("image/heic")).toBe(false); // not accepted by the OpenRouter vision model
    expect(gatewayFor({ geminiApiKey: undefined, openRouterApiKey: undefined }).canAnalyzeImage("image/png")).toBe(false);
  });

  it("a vision-capable OpenRouter model is used directly when Gemini has no key", async () => {
    const stub = stubProviders({ openrouter: openRouterText("An OpenRouter reading.") });
    const result = await gatewayFor({ geminiApiKey: undefined, openRouterModelCapabilities: "vision" }).analyzeImage({ data: PNG, mimeType: "image/jpeg" });

    expect(result.text).toBe("An OpenRouter reading.");
    expect(stub.gemini).toHaveLength(0);
    expect(result.meta).toMatchObject({ provider: "openrouter", fallback: false });
  });
});

describe("OpenRouter failure inside an HTTP 200 (non-streaming)", () => {
  it("an error object in a 200 body is a provider failure, not an empty answer", async () => {
    stubProviders({ openrouter: () => new Response(JSON.stringify({ error: { code: 429, message: "Rate limit exceeded: free-models-per-day." } }), { status: 200 }) });
    const failure = await error(gatewayFor({ geminiApiKey: undefined }).generate(chatRequest()));

    expect(failure).toMatchObject({ code: "AI_QUOTA_EXCEEDED", kind: "AI_PROVIDER_QUOTA_EXCEEDED" });
  });

  it("a 200 with no choices is reported as an unreadable provider response", async () => {
    stubProviders({ openrouter: () => new Response(JSON.stringify({ id: "x", choices: [] }), { status: 200 }) });
    const failure = await error(gatewayFor({ geminiApiKey: undefined }).generate(chatRequest()));

    expect(failure).toMatchObject({ kind: "AI_PROVIDER_UNAVAILABLE", retryable: true });
  });

  it("OpenRouter's documented 402 (no credits) is an exhausted quota that is never retried", async () => {
    const stub = stubProviders({ openrouter: openRouterFail(402, "Insufficient credits") });
    const failure = await error(gatewayFor({ geminiApiKey: undefined }).generate(chatRequest()));

    expect(stub.openrouter).toHaveLength(1);
    expect(failure).toMatchObject({ code: "AI_QUOTA_EXCEEDED", quotaType: "credits", retryable: false });
  });
});
