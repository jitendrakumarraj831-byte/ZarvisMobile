import { afterEach, describe, expect, it, vi } from "vitest";
import { withModelCallLog, type ModelCallRecord } from "../../src/ai/callTrace.js";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import { createModelGateway } from "../../src/ai/providerFactory.js";
import { DAILY, quotaBody } from "./geminiFixtures.js";
import {
  OPENAI_KEY,
  chatRequest,
  fakeEnv,
  geminiFail,
  geminiText,
  openRouterCall,
  openRouterFail,
  openRouterSse,
  openRouterText,
  searchTool,
  sseResponse,
  stubProviders,
} from "./gatewayHarness.js";

// The retry policy's waits are covered in geminiErrors.test.ts; here they would only slow the tests.
vi.mock("../../src/ai/geminiErrors.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/ai/geminiErrors.js")>()),
  sleep: async () => {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** All three providers configured: Gemini, OpenRouter (tools declared), and an OpenAI-compatible endpoint. */
function gatewayFor(overrides: Parameters<typeof fakeEnv>[0] = {}, now?: () => number) {
  return createModelGateway(
    fakeEnv({ openRouterModelCapabilities: "tools", openAiApiKey: OPENAI_KEY, openAiModel: "openai-test-model", ...overrides }),
    { isProduction: true, now },
  );
}

const geminiSpent = () => geminiFail(429, quotaBody(DAILY));
const plannerRequest = () => chatRequest({ purpose: "planner", tools: [searchTool] });
const error = async (promise: Promise<unknown>) => (await promise.then(() => undefined, (e: unknown) => e)) as AIProviderError;

describe("ModelGateway: the three-provider chain (Gemini -> OpenRouter -> OpenAI-compatible)", () => {
  it("the production case: Gemini's quota is spent and OpenRouter has no endpoint for the model (404), so the OpenAI-compatible endpoint answers the planner", async () => {
    const stub = stubProviders({
      gemini: geminiSpent(),
      openrouter: openRouterFail(404, "No endpoints found matching your data policy (Free model training)"),
      openai: openRouterCall("web-search", { query: "weather in Forbesganj" }),
    });
    const log: ModelCallRecord[] = [];

    const response = await withModelCallLog(log, () => gatewayFor().generate(plannerRequest()));

    expect(response.toolCalls[0]).toMatchObject({ skillId: "web.search", input: { query: "weather in Forbesganj" } });
    expect(response.meta).toMatchObject({ provider: "openai", configuredModel: "openai-test-model", fallback: true, fallbackReason: "OPENROUTER_CAPABILITY_UNSUPPORTED", attempts: 3 });
    // Each provider asked once (Gemini once per model, its quota being per model), in order, under one logical call.
    expect([stub.gemini.length, stub.openrouter.length, stub.openai.length]).toEqual([2, 1, 1]);
    expect(stub.calls.map((call) => call.host)).toEqual(["gemini", "gemini", "openrouter", "openai"]);
    expect(log.map((record) => [record.provider, record.outcome, record.fallback ?? false, record.fallbackReason])).toEqual([
      ["google", "error", false, undefined],
      ["openrouter", "error", true, "GEMINI_QUOTA_EXCEEDED"],
      ["openai", "ok", true, "OPENROUTER_CAPABILITY_UNSUPPORTED"],
    ]);
  });

  it("speaks plain OpenAI to the third provider: its own URL, key and model, no OpenRouter extensions or headers", async () => {
    const stub = stubProviders({ gemini: geminiSpent(), openrouter: openRouterFail(503, "down"), openai: openRouterText("from openai", "openai-test-model") });
    await gatewayFor({ openRouterFallbackModels: "a/b" }).generate(plannerRequest());

    const [call] = stub.openai;
    expect(call!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(call!.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(call!.headers).not.toHaveProperty("http-referer");
    expect(call!.headers).not.toHaveProperty("x-title");
    expect(call!.body).toMatchObject({ model: "openai-test-model", stream: false, tools: [expect.objectContaining({ type: "function" })] });
    expect(call!.body).not.toHaveProperty("models");
    expect(call!.body).not.toHaveProperty("provider");
  });

  it("an OpenAI-compatible endpoint other than OpenAI's is addressed at OPENAI_BASE_URL, and OPENAI_MAX_OUTPUT_TOKENS caps every reply", async () => {
    // The harness routes by host name, so the custom endpoint keeps OpenAI's host under another path.
    const stub = stubProviders({ gemini: geminiSpent(), openrouter: openRouterFail(503, "down"), openai: openRouterText("ok") });
    await gatewayFor({ openAiBaseUrl: "https://api.openai.com/compat/v1/", openAiMaxOutputTokens: "256" }).generate(chatRequest({ modelConfig: { provider: "x", model: "y", maxTokens: 4000 } }));
    expect(stub.openai[0]!.url).toBe("https://api.openai.com/compat/v1/chat/completions");
    expect(stub.openai[0]!.body.max_tokens).toBe(256);
  });

  it("an OPENAI_API_KEY without OPENAI_MODEL leaves the third provider out: nothing is sent to it", async () => {
    const stub = stubProviders({ gemini: geminiSpent(), openrouter: openRouterFail(503, "down"), openai: openRouterText("must not run") });
    const gateway = gatewayFor({ openAiModel: undefined });
    const failure = await error(gateway.generate(plannerRequest()));

    expect(failure).toBeInstanceOf(AIProviderError);
    expect(stub.openai).toHaveLength(0);
    expect(gateway.getProviderStatus().effective.fallbacks).toEqual(["openrouter"]);
  });

  it("AI_FALLBACK_PROVIDER sets the order: the OpenAI-compatible endpoint before OpenRouter", async () => {
    const stub = stubProviders({ gemini: geminiSpent(), openrouter: openRouterText("must not run"), openai: openRouterText("from openai") });
    const response = await gatewayFor({ aiFallbackProvider: "openai,openrouter" }).generate(chatRequest());

    expect(response.meta).toMatchObject({ provider: "openai", fallbackReason: "GEMINI_QUOTA_EXCEEDED", attempts: 2 });
    expect(stub.openrouter).toHaveLength(0);
  });

  it("a fallback's own rejected key is that provider's problem: the chain moves on to the next one", async () => {
    const stub = stubProviders({ gemini: geminiSpent(), openrouter: openRouterFail(401, "No auth credentials found"), openai: openRouterText("from openai") });
    const response = await gatewayFor().generate(chatRequest());

    expect(response.meta).toMatchObject({ provider: "openai", fallback: true, fallbackReason: "OPENROUTER_UNAVAILABLE" });
    expect(stub.openrouter).toHaveLength(1);
    expect(stub.openai).toHaveLength(1);
  });

  it("the primary's own rejected key still never starts the chain", async () => {
    const stub = stubProviders({ gemini: geminiFail(403, JSON.stringify({ error: { message: "API key not valid" } })), openrouter: openRouterText("must not run"), openai: openRouterText("must not run") });
    const failure = await error(gatewayFor().generate(chatRequest()));

    expect(failure.kind).toBe("AI_PROVIDER_AUTH_ERROR");
    expect(stub.openrouter).toHaveLength(0);
    expect(stub.openai).toHaveLength(0);
  });

  it("a request the provider refuses (400) ends the call even mid-chain: another provider must not accept what one refused", async () => {
    const stub = stubProviders({ gemini: geminiSpent(), openrouter: openRouterFail(400, "Invalid request"), openai: openRouterText("must not run") });
    const failure = await error(gatewayFor().generate(chatRequest()));

    // The user is told the true condition of the primary (out of quota), not the refusal detail.
    expect(failure).toMatchObject({ code: "AI_QUOTA_EXCEEDED", kind: "AI_PROVIDER_QUOTA_EXCEEDED" });
    expect(stub.openai).toHaveLength(0);
  });

  it("when every provider is out of quota the user gets ONE honest quota error, and each provider was asked exactly once", async () => {
    const stub = stubProviders({
      gemini: geminiSpent(),
      openrouter: openRouterFail(429, "Rate limit exceeded: free-models-per-day."),
      openai: () => new Response(JSON.stringify({ error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } }), { status: 429 }),
    });
    const failure = await error(gatewayFor().generate(chatRequest()));

    expect(failure).toMatchObject({ code: "AI_QUOTA_EXCEEDED", kind: "AI_PROVIDER_QUOTA_EXCEEDED", retryable: false });
    expect(failure.attempts?.map((attempt) => [attempt.provider, attempt.kind])).toEqual([
      ["google", "AI_PROVIDER_QUOTA_EXCEEDED"],
      ["openrouter", "AI_PROVIDER_QUOTA_EXCEEDED"],
      ["openai", "AI_PROVIDER_QUOTA_EXCEEDED"],
    ]);
    // OpenAI's `insufficient_quota` is an empty balance: never retried.
    expect([stub.gemini.length, stub.openrouter.length, stub.openai.length]).toEqual([2, 1, 1]);
  });

  it("after two providers report a spent quota, the next calls go straight to the third, until the cooldown ends", async () => {
    let clock = 5_000_000;
    const stub = stubProviders({
      gemini: geminiSpent(),
      openrouter: openRouterFail(429, "Rate limit exceeded: free-models-per-day."),
      openai: openRouterText("from openai"),
    });
    const gateway = gatewayFor({ aiQuotaCooldownMs: "60000" }, () => clock);

    await gateway.generate(chatRequest());
    expect([stub.gemini.length, stub.openrouter.length, stub.openai.length]).toEqual([2, 1, 1]);

    clock += 10_000;
    const second = await gateway.generate(chatRequest());
    expect(second.meta).toMatchObject({ provider: "openai", fallback: true, fallbackReason: "GEMINI_QUOTA_COOLDOWN" });
    // No request is spent on the two providers known to refuse it.
    expect([stub.gemini.length, stub.openrouter.length, stub.openai.length]).toEqual([2, 1, 2]);

    clock += 60_000; // the cooldown is over: Gemini is asked again first
    await gateway.generate(chatRequest());
    expect(stub.gemini.length).toBeGreaterThan(2);
  });

  it("streams through the chain before the first chunk, and never switches once text was delivered", async () => {
    const stub = stubProviders({
      gemini: geminiSpent(),
      openrouter: openRouterFail(503, "overloaded"),
      openai: () => sseResponse([openRouterSse("From the "), openRouterSse("third."), "data: [DONE]\n\n"]),
    });
    const chunks: Array<{ delta: string; done: boolean; meta?: unknown }> = [];
    for await (const chunk of gatewayFor().streamText(chatRequest())) chunks.push(chunk);

    expect(chunks.filter((chunk) => !chunk.done).map((chunk) => chunk.delta).join("")).toBe("From the third.");
    expect(chunks.at(-1)).toMatchObject({ done: true, meta: { provider: "openai", fallback: true, fallbackReason: "OPENROUTER_UNAVAILABLE" } });
    expect(stub.openai[0]!.body).toMatchObject({ stream: true });
  });

  it("Gemini answering keeps every other provider untouched", async () => {
    const stub = stubProviders({ gemini: geminiText("Gemini answered."), openrouter: openRouterText("must not run"), openai: openRouterText("must not run") });
    const response = await gatewayFor().generate(chatRequest());

    expect(response.meta).toMatchObject({ provider: "google", fallback: false, attempts: 1 });
    expect(stub.openrouter).toHaveLength(0);
    expect(stub.openai).toHaveLength(0);
  });

  it("the health summary and status describe the whole chain without a key", () => {
    const gateway = gatewayFor();
    expect(gateway.healthSummary()).toEqual({ provider: "google", fallback: true, fallbackTools: true });
    const status = gateway.getProviderStatus();
    expect(status.effective).toEqual({ mode: "live", primary: "google", fallback: "openrouter", fallbacks: ["openrouter", "openai"] });
    expect(JSON.stringify(status)).not.toContain(OPENAI_KEY);
  });
});
