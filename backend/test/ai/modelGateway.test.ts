import { afterEach, describe, expect, it, vi } from "vitest";
import { withModelCallLog, type ModelCallRecord } from "../../src/ai/callTrace.js";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import { createModelGateway } from "../../src/ai/providerFactory.js";
import { providerErrorPayload } from "../../src/ai/geminiErrors.js";
import { logger } from "../../src/security/redact.js";
import { DAILY, PER_MINUTE, quotaBody } from "./geminiFixtures.js";
import {
  GEMINI_KEY,
  OPENROUTER_KEY,
  chatRequest,
  fakeEnv,
  geminiCall,
  geminiFail,
  geminiText,
  openRouterCall,
  openRouterFail,
  openRouterText,
  searchTool,
  sequence,
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
  vi.useRealTimers();
});

function gatewayFor(envOverrides: Parameters<typeof fakeEnv>[0] = {}, options: { isProduction?: boolean; now?: () => number } = {}) {
  return createModelGateway(fakeEnv(envOverrides), { isProduction: options.isProduction ?? true, now: options.now });
}

/** Captures what the logger was asked to write (before redaction), keyed by message. */
function captureLogs() {
  const lines: Array<{ level: string; message: string; data: Record<string, any> }> = [];
  for (const level of ["info", "warn", "error"] as const) {
    vi.spyOn(logger, level).mockImplementation((message: string, data?: Record<string, unknown>) => {
      lines.push({ level, message, data: (data ?? {}) as Record<string, any> });
    });
  }
  return lines;
}

const error = async (promise: Promise<unknown>) => (await promise.then(() => undefined, (e: unknown) => e)) as AIProviderError;

describe("ModelGateway: choosing a provider", () => {
  it("Gemini success: exactly one Gemini request, nothing sent to OpenRouter, no fallback", async () => {
    const stub = stubProviders({ gemini: geminiText("Rivers carry mountains to the sea.") });
    const response = await gatewayFor().generate(chatRequest());

    expect(response.message.content).toBe("Rivers carry mountains to the sea.");
    expect(stub.gemini).toHaveLength(1);
    expect(stub.openrouter).toHaveLength(0);
    expect(response.meta).toMatchObject({ provider: "google", model: "gemini-3.6-flash", configuredModel: "gemini-3.6-flash", fallback: false, attempts: 1 });
    expect(response.meta?.fallbackReason).toBeUndefined();
  });

  it("OpenRouter success: when Gemini has no key, OpenRouter answers (and reports the model that served it)", async () => {
    const stub = stubProviders({ openrouter: openRouterText("Rivers are old.", "vendor/some-free-model:free") });
    const response = await gatewayFor({ geminiApiKey: undefined }).generate(chatRequest());

    expect(response.message.content).toBe("Rivers are old.");
    expect(response.usage).toEqual({ promptTokens: 11, completionTokens: 4 });
    expect(stub.gemini).toHaveLength(0);
    expect(stub.openrouter).toHaveLength(1);
    expect(response.meta).toMatchObject({ provider: "openrouter", model: "vendor/some-free-model:free", configuredModel: "openrouter/free", fallback: false });
  });

  it("OpenRouter never receives a request when the fallback is switched off", async () => {
    const stub = stubProviders({ gemini: geminiFail(429, quotaBody(DAILY)) });
    const failure = await error(gatewayFor({ aiFallbackProvider: "none" }).generate(chatRequest()));

    expect(failure).toMatchObject({ code: "AI_QUOTA_EXCEEDED", kind: "AI_PROVIDER_QUOTA_EXCEEDED" });
    expect(stub.openrouter).toHaveLength(0);
  });

  it("a preferred OpenRouter primary falls back to Gemini the same way", async () => {
    const stub = stubProviders({ openrouter: openRouterFail(503, "upstream down"), gemini: geminiText("From Gemini.") });
    const response = await gatewayFor({ aiPrimaryProvider: "openrouter" }).generate(chatRequest());

    expect(response.message.content).toBe("From Gemini.");
    expect(response.meta).toMatchObject({ provider: "google", fallback: true, fallbackReason: "OPENROUTER_UNAVAILABLE" });
    expect(stub.openrouter.length).toBeGreaterThanOrEqual(1);
    expect(stub.gemini).toHaveLength(1);
  });
});

describe("ModelGateway: controlled fallback (Gemini -> OpenRouter)", () => {
  it.each([
    ["an exhausted daily quota: one request, no retry", geminiFail(429, quotaBody(DAILY)), 1, "GEMINI_QUOTA_EXCEEDED"],
    ["a per-minute limit with a long advised wait: one request", geminiFail(429, quotaBody(PER_MINUTE, "40s")), 1, "GEMINI_RATE_LIMITED"],
    ["a per-minute limit with a short wait: one bounded retry first", geminiFail(429, quotaBody(PER_MINUTE, "1s")), 2, "GEMINI_RATE_LIMITED"],
    ["a 503: bounded retries on two models, then OpenRouter", geminiFail(503), 6, "GEMINI_UNAVAILABLE"],
  ])("%s", async (_label, gemini, geminiRequests, reason) => {
    const stub = stubProviders({ gemini, openrouter: openRouterText("Answered by OpenRouter.") });
    const log: ModelCallRecord[] = [];

    const response = await withModelCallLog(log, () => gatewayFor().generate(chatRequest()));

    expect(response.message.content).toBe("Answered by OpenRouter.");
    expect(stub.gemini).toHaveLength(geminiRequests);
    expect(stub.openrouter).toHaveLength(1); // exactly one fallback attempt
    expect(response.meta).toMatchObject({ provider: "openrouter", fallback: true, fallbackReason: reason, attempts: 2 });
    // A switch is never silent: both attempts are in the call log, under one logical call.
    expect(log.map((record) => [record.provider, record.outcome, record.fallback ?? false])).toEqual([
      ["google", "error", false],
      ["openrouter", "ok", true],
    ]);
    expect(new Set(log.map((record) => record.modelCallId)).size).toBe(1);
    expect(log[1]?.fallbackReason).toBe(reason);
  });

  it("a timeout falls back too (and is not retried on the same provider)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const hang = (call: { signal?: AbortSignal | null }) =>
      new Promise<Response>((_resolve, reject) => {
        call.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const stub = stubProviders({ gemini: hang as never, openrouter: openRouterText("Fast enough.") });

    const pending = gatewayFor().generate(chatRequest());
    await vi.advanceTimersByTimeAsync(90_001);
    const response = await pending;

    expect(stub.gemini).toHaveLength(1);
    expect(response.meta).toMatchObject({ provider: "openrouter", fallback: true, fallbackReason: "GEMINI_TIMEOUT" });
  });

  it("a network failure is retried a bounded number of times, then falls back", async () => {
    const stub = stubProviders({
      gemini: () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
      },
      openrouter: openRouterText("Recovered."),
    });
    const response = await gatewayFor().generate(chatRequest());

    expect(stub.gemini).toHaveLength(6); // 3 attempts on each of Gemini's two models
    expect(stub.openrouter).toHaveLength(1);
    expect(response.meta).toMatchObject({ fallback: true, fallbackReason: "GEMINI_UNAVAILABLE" });
  });

  it("OpenRouter failing too ends the call: no third attempt, no return to Gemini", async () => {
    const stub = stubProviders({ gemini: geminiFail(429, quotaBody(DAILY)), openrouter: openRouterFail(503, "overloaded") });
    const failure = await error(gatewayFor().generate(chatRequest()));

    expect(stub.gemini).toHaveLength(1);
    expect(stub.openrouter).toHaveLength(3); // the shared policy: two bounded retries of a transient 5xx
    expect(failure).toBeInstanceOf(AIProviderError);
    expect(failure.kind).toBe("AI_PROVIDER_UNAVAILABLE"); // the last provider asked is the final state
    expect(failure.attempts?.map((attempt) => [attempt.provider, attempt.kind])).toEqual([
      ["google", "AI_PROVIDER_QUOTA_EXCEEDED"],
      ["openrouter", "AI_PROVIDER_UNAVAILABLE"],
    ]);
  });

  it("OpenRouter's own daily limit is reported as an exhausted quota after one request", async () => {
    const stub = stubProviders({
      gemini: geminiFail(429, quotaBody(DAILY)),
      openrouter: openRouterFail(429, "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day", {
        headers: { "X-RateLimit-Limit": "50", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(Date.now() + 5 * 3_600_000) },
      }),
    });
    const failure = await error(gatewayFor().generate(chatRequest()));

    expect(stub.openrouter).toHaveLength(1); // a daily quota is never retried
    expect(failure).toMatchObject({ code: "AI_QUOTA_EXCEEDED", kind: "AI_PROVIDER_QUOTA_EXCEEDED", quotaType: "daily", retryable: false });
    expect(failure.retryAfterMs).toBeUndefined(); // a daily reset is never waited for in a request
  });

  it("OpenRouter's per-minute limit is retried once, then reported as a rate limit", async () => {
    const stub = stubProviders({ gemini: geminiFail(503), openrouter: openRouterFail(429, "Rate limit exceeded: free-models-per-min.") });
    const failure = await error(gatewayFor().generate(chatRequest()));

    expect(stub.openrouter).toHaveLength(2);
    expect(failure).toMatchObject({ code: "AI_RATE_LIMITED", kind: "AI_PROVIDER_RATE_LIMIT", retryable: true });
  });

  it("an OpenRouter misconfiguration does not hide the primary's real condition from the user", async () => {
    stubProviders({ gemini: geminiFail(429, quotaBody(DAILY)), openrouter: openRouterFail(401, "No auth credentials found") });
    const failure = await error(gatewayFor().generate(chatRequest()));

    // The user is told the AI is out of quota (true), not that "the AI is unavailable" because
    // of a key problem they cannot fix; both failures are in the log's attempts.
    expect(failure).toMatchObject({ code: "AI_QUOTA_EXCEEDED", kind: "AI_PROVIDER_QUOTA_EXCEEDED" });
    expect(failure.attempts?.map((attempt) => attempt.kind)).toEqual(["AI_PROVIDER_QUOTA_EXCEEDED", "AI_PROVIDER_AUTH_ERROR"]);
  });
});

describe("ModelGateway: failures that must NOT fall back", () => {
  it.each([
    ["Gemini rejects the API key (403)", 403, "AI_PROVIDER_AUTH_ERROR"],
    ["Gemini rejects the credentials (401)", 401, "AI_PROVIDER_AUTH_ERROR"],
    ["Gemini rejects the request itself (400)", 400, "AI_PROVIDER_INVALID_REQUEST"],
    ["the configured Gemini model does not exist (404)", 404, "AI_PROVIDER_CAPABILITY_UNSUPPORTED"],
  ])("%s: one request, no OpenRouter request", async (_label, status, kind) => {
    const stub = stubProviders({ gemini: geminiFail(status, JSON.stringify({ error: { message: `provider said no ${GEMINI_KEY}` } })), openrouter: openRouterText("must not run") });
    const failure = await error(gatewayFor().generate(chatRequest()));

    expect(failure).toBeInstanceOf(AIProviderError);
    expect(failure.kind).toBe(kind);
    expect(failure.code).toBe("AI_UNAVAILABLE");
    // 404 tries Gemini's own next model first; nothing else ever repeats the request.
    expect(stub.gemini).toHaveLength(status === 404 ? 2 : 1);
    expect(stub.openrouter).toHaveLength(0);
    // What reaches a client names no provider, key or kind.
    expect(JSON.stringify(providerErrorPayload(failure))).not.toContain(GEMINI_KEY);
    expect(providerErrorPayload(failure)).not.toHaveProperty("kind");
  });

  it("an OpenRouter primary with a rejected key does not fall back to Gemini", async () => {
    const stub = stubProviders({ openrouter: openRouterFail(401, "No auth credentials found"), gemini: geminiText("must not run") });
    const failure = await error(gatewayFor({ aiPrimaryProvider: "openrouter" }).generate(chatRequest()));

    expect(failure.kind).toBe("AI_PROVIDER_AUTH_ERROR");
    expect(stub.openrouter).toHaveLength(1);
    expect(stub.gemini).toHaveLength(0);
  });

  it("an application bug is rethrown untouched and never answered from another provider", async () => {
    const stub = stubProviders({
      gemini: () => {
        throw new TypeError("Cannot read properties of undefined (reading 'x')");
      },
      openrouter: openRouterText("must not run"),
    });
    const failure = await error(gatewayFor().generate(chatRequest()));

    expect(failure).toBeInstanceOf(TypeError);
    expect(stub.openrouter).toHaveLength(0);
  });

  it("a cancelled turn is not a provider failure: no fallback", async () => {
    const controller = new AbortController();
    const stub = stubProviders({
      gemini: () => {
        controller.abort();
        return new Response("busy", { status: 503 });
      },
      openrouter: openRouterText("must not run"),
    });
    const failure = await error(gatewayFor().generate(chatRequest({ signal: controller.signal })));

    expect(failure.name).toBe("AbortError");
    expect(stub.gemini).toHaveLength(1);
    expect(stub.openrouter).toHaveLength(0);
  });

  it("a request that is already cancelled sends nothing at all", async () => {
    const stub = stubProviders({ gemini: geminiText("x"), openrouter: openRouterText("y") });
    const controller = new AbortController();
    controller.abort();
    const failure = await error(gatewayFor().generate(chatRequest({ signal: controller.signal })));

    expect(failure.name).toBe("AbortError");
    expect(stub.calls).toHaveLength(0);
  });
});

describe("ModelGateway: capability-aware routing", () => {
  const quota = geminiFail(429, quotaBody(DAILY));

  it("a tool-using request is NOT sent to a fallback model that does not declare tools", async () => {
    const stub = stubProviders({ gemini: quota, openrouter: openRouterText("must not run") });
    const failure = await error(gatewayFor().generate(chatRequest({ purpose: "planner", tools: [searchTool] })));

    // The honest, real cause is returned; OpenRouter was never asked (so no tool is faked).
    expect(failure).toMatchObject({ code: "AI_QUOTA_EXCEEDED" });
    expect(stub.openrouter).toHaveLength(0);
  });

  it("with tools declared for the OpenRouter model, the planner falls back and the tool call round-trips", async () => {
    const stub = stubProviders({ gemini: quota, openrouter: openRouterCall("web-search", { query: "kal ka weather" }) });
    const response = await gatewayFor({ openRouterModelCapabilities: "tools" }).generate(chatRequest({ purpose: "planner", tools: [searchTool] }));

    const sent = stub.openrouter[0]!.body;
    expect(sent.tools).toEqual([
      {
        type: "function",
        function: { name: "web-search", description: "Search the live web", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      },
    ]);
    // Without this OpenRouter could route to an endpoint that silently drops the tools.
    expect(sent.provider).toEqual({ require_parameters: true });
    expect(response.toolCalls).toEqual([{ id: "call_1", skillId: "web.search", input: { query: "kal ka weather" } }]);
    expect(response.meta).toMatchObject({ provider: "openrouter", fallback: true, fallbackReason: "GEMINI_QUOTA_EXCEEDED" });
  });

  it("malformed tool arguments become an EMPTY input, never an invented one", async () => {
    stubProviders({ gemini: quota, openrouter: openRouterCall("web-search", "{not json") });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const response = await gatewayFor({ openRouterModelCapabilities: "tools" }).generate(chatRequest({ purpose: "planner", tools: [searchTool] }));

    expect(response.toolCalls).toEqual([{ id: "call_1", skillId: "web.search", input: {} }]);
    expect(warn).toHaveBeenCalledWith("OpenRouter returned tool arguments that are not a JSON object; the call runs with empty input", { skillId: "web.search" });
  });

  it("a tool name the model rewrote is matched only when exactly one offered tool fits; otherwise it passes through", async () => {
    const twoTools = [searchTool, { ...searchTool, name: "docs.summarize", description: "Summarize", inputSchema: { requiredFields: ["text"], properties: { text: "string" } } }];
    stubProviders({ openrouter: openRouterCall("web_search", { query: "x" }) });
    const rewritten = await gatewayFor({ geminiApiKey: undefined, openRouterModelCapabilities: "tools" }).generate(chatRequest({ purpose: "planner", tools: twoTools }));
    expect(rewritten.toolCalls[0]?.skillId).toBe("web.search");

    stubProviders({ openrouter: openRouterCall("invented_tool", {}) });
    const unknown = await gatewayFor({ geminiApiKey: undefined, openRouterModelCapabilities: "tools" }).generate(chatRequest({ purpose: "planner", tools: twoTools }));
    // Not guessed: the tool pipeline answers "I don't have a skill for that".
    expect(unknown.toolCalls[0]?.skillId).toBe("invented_tool");
  });

  it("with only OpenRouter configured and no declared tool support, a tool request fails with a structured capability error and sends nothing", async () => {
    const stub = stubProviders({ openrouter: openRouterText("must not run") });
    const failure = await error(gatewayFor({ geminiApiKey: undefined }).generate(chatRequest({ purpose: "planner", tools: [searchTool] })));

    expect(failure).toMatchObject({ kind: "AI_PROVIDER_CAPABILITY_UNSUPPORTED", code: "AI_UNAVAILABLE", retryable: false });
    expect(stub.calls).toHaveLength(0);
    expect(failure.message).toContain("openrouter: tools");
  });

  it("a prompt too large for the fallback model's declared context is not sent there", async () => {
    const stub = stubProviders({ gemini: quota, openrouter: openRouterText("must not run") });
    const huge = "देवनागरी ".repeat(40_000); // far beyond the default 32k-token context
    const failure = await error(gatewayFor().generate(chatRequest({ messages: [{ role: "user", content: huge }] })));

    expect(failure.code).toBe("AI_QUOTA_EXCEEDED");
    expect(stub.openrouter).toHaveLength(0);
  });

  it("a larger declared context makes the same prompt eligible", async () => {
    const stub = stubProviders({ gemini: quota, openrouter: openRouterText("Fits.") });
    const long = "word ".repeat(30_000);
    const response = await gatewayFor({ openRouterModelContextTokens: "200000" }).generate(chatRequest({ messages: [{ role: "user", content: long }] }));

    expect(response.message.content).toBe("Fits.");
    expect(stub.openrouter).toHaveLength(1);
  });

  it("a caller that requires `coding` only reaches a model that declares it", async () => {
    const stubA = stubProviders({ gemini: quota, openrouter: openRouterText("must not run") });
    const failure = await error(gatewayFor().generate(chatRequest({ requires: ["coding"] })));
    expect(failure.code).toBe("AI_QUOTA_EXCEEDED");
    expect(stubA.openrouter).toHaveLength(0);

    const stubB = stubProviders({ gemini: quota, openrouter: openRouterText("code") });
    const response = await gatewayFor({ openRouterModelCapabilities: "coding" }).generate(chatRequest({ requires: ["coding"] }));
    expect(response.meta?.provider).toBe("openrouter");
    expect(stubB.openrouter).toHaveLength(1);
  });

  it("structured output is requested from OpenRouter only when the model declares it", async () => {
    const stubA = stubProviders({ gemini: quota, openrouter: openRouterText("{}") });
    expect((await error(gatewayFor().generate(chatRequest({ responseFormat: "json" })))).code).toBe("AI_QUOTA_EXCEEDED");
    expect(stubA.openrouter).toHaveLength(0);

    const stubB = stubProviders({ gemini: quota, openrouter: openRouterText("{}") });
    await gatewayFor({ openRouterModelCapabilities: "structuredOutput" }).generate(chatRequest({ responseFormat: "json" }));
    expect(stubB.openrouter[0]!.body.response_format).toEqual({ type: "json_object" });
    expect(stubB.openrouter[0]!.body.provider).toEqual({ require_parameters: true });
  });

  it("the catalog JSON can describe several OpenRouter models; the most preferred capable one is used", async () => {
    const catalog = JSON.stringify([
      { provider: "openrouter", model: "vendor/small:free", priority: 1, streaming: true },
      { provider: "openrouter", model: "vendor/tooling-model", priority: 2, streaming: true, tools: true, contextTokens: 64000 },
    ]);
    const stubA = stubProviders({ gemini: quota, openrouter: openRouterText("plain") });
    await gatewayFor({ aiModelCatalogJson: catalog }).generate(chatRequest());
    expect(stubA.openrouter[0]!.body.model).toBe("vendor/small:free");

    const stubB = stubProviders({ gemini: quota, openrouter: openRouterCall("web-search", { query: "q" }) });
    await gatewayFor({ aiModelCatalogJson: catalog }).generate(chatRequest({ purpose: "planner", tools: [searchTool] }));
    expect(stubB.openrouter[0]!.body.model).toBe("vendor/tooling-model");
  });

  it("generateText refuses tools only by routing: the named API maps onto the same rules", async () => {
    stubProviders({ gemini: geminiText("ok") });
    const gateway = gatewayFor();
    expect((await gateway.generateText({ systemPrompt: "s", messages: [{ role: "user", content: "hi" }], modelConfig: { provider: "x", model: "y" } })).message.content).toBe("ok");
    expect(() => gateway.generateWithTools({ ...chatRequest(), tools: [] })).toThrow(/at least one tool/);
  });
});

describe("ModelGateway: quota cooldown", () => {
  it("after a spent Gemini quota, later calls go straight to a capable fallback; Gemini is probed again after the cooldown", async () => {
    let clock = 1_000_000;
    const stub = stubProviders({
      gemini: sequence(geminiFail(429, quotaBody(DAILY)), geminiText("Gemini is back.")),
      openrouter: openRouterText("Fallback answer."),
    });
    const gateway = gatewayFor({ aiQuotaCooldownMs: "60000" }, { now: () => clock });

    const first = await gateway.generate(chatRequest());
    expect(first.meta).toMatchObject({ provider: "openrouter", fallbackReason: "GEMINI_QUOTA_EXCEEDED" });
    expect(stub.gemini).toHaveLength(1);

    clock += 10_000; // still cooling down
    const second = await gateway.generate(chatRequest());
    expect(second.meta).toMatchObject({ provider: "openrouter", fallback: true, fallbackReason: "GEMINI_QUOTA_COOLDOWN" });
    expect(stub.gemini).toHaveLength(1); // no request wasted on a provider known to refuse it
    expect(stub.openrouter).toHaveLength(2);

    clock += 60_000; // cooldown over: Gemini is tried again, and its success clears the state
    const third = await gateway.generate(chatRequest());
    expect(third.message.content).toBe("Gemini is back.");
    expect(third.meta).toMatchObject({ provider: "google", fallback: false });
    expect(stub.gemini).toHaveLength(2);
  });

  it("a Gemini-only deployment is unaffected: a request is still tried on Gemini every time", async () => {
    const stub = stubProviders({ gemini: geminiFail(429, quotaBody(DAILY)) });
    const gateway = gatewayFor({ openRouterApiKey: undefined });

    await error(gateway.generate(chatRequest()));
    await error(gateway.generate(chatRequest()));

    expect(stub.gemini).toHaveLength(2);
  });

  it("a request the fallback cannot serve is still tried on Gemini during the cooldown", async () => {
    const stub = stubProviders({ gemini: sequence(geminiFail(429, quotaBody(DAILY)), geminiCall("web.search", { query: "q" })), openrouter: openRouterText("plain") });
    const gateway = gatewayFor();

    await gateway.generate(chatRequest()); // spends the quota, falls back (no tools needed)
    const withTools = await gateway.generate(chatRequest({ purpose: "planner", tools: [searchTool] }));

    expect(withTools.toolCalls[0]?.skillId).toBe("web.search");
    expect(stub.gemini).toHaveLength(2);
  });

  it("AI_QUOTA_COOLDOWN_MS=0 turns the cooldown off", async () => {
    const stub = stubProviders({ gemini: geminiFail(429, quotaBody(DAILY)), openrouter: openRouterText("fb") });
    const gateway = gatewayFor({ aiQuotaCooldownMs: "0" });

    await gateway.generate(chatRequest());
    await gateway.generate(chatRequest());

    expect(stub.gemini).toHaveLength(2);
  });
});

describe("ModelGateway: no provider configured", () => {
  it("production: an honest AI_UNAVAILABLE, never a fabricated answer", async () => {
    const stub = stubProviders({});
    const failure = await error(gatewayFor({ geminiApiKey: undefined, openRouterApiKey: undefined }, { isProduction: true }).generate(chatRequest()));

    expect(failure).toMatchObject({ code: "AI_UNAVAILABLE", status: 503, retryable: false });
    expect(stub.calls).toHaveLength(0);
  });

  it("development: the labelled deterministic mock answers, and only when nothing real is configured", async () => {
    stubProviders({});
    const gateway = gatewayFor({ geminiApiKey: undefined, openRouterApiKey: undefined }, { isProduction: false });
    const response = await gateway.generate(chatRequest({ purpose: "planner", messages: [{ role: "user", content: "please search the web" }], tools: [searchTool] }));

    expect(response.meta?.provider).toBe("mock");
    expect(response.toolCalls[0]?.skillId).toBe("web.search");
    expect(gateway.healthSummary()).toEqual({ provider: "mock", fallback: false });
  });

  it("the mock is never a fallback and is never used when a real provider is configured but cannot serve the request", async () => {
    const stub = stubProviders({ gemini: geminiFail(429, quotaBody(DAILY)) });
    const failure = await error(gatewayFor({ openRouterApiKey: undefined }, { isProduction: false }).generate(chatRequest()));
    expect(failure.code).toBe("AI_QUOTA_EXCEEDED"); // not a canned mock reply
    expect(stub.gemini).toHaveLength(1);

    stubProviders({ openrouter: openRouterText("must not run") });
    const capability = await error(gatewayFor({ geminiApiKey: undefined }, { isProduction: false }).generate(chatRequest({ purpose: "planner", tools: [searchTool] })));
    expect(capability.kind).toBe("AI_PROVIDER_CAPABILITY_UNSUPPORTED");
  });
});

describe("ModelGateway: one logical call, one log line, no secrets", () => {
  it("logs provider, model, fallback, reason, latency, status and retry count for the call", async () => {
    stubProviders({ gemini: sequence(geminiFail(429, quotaBody(PER_MINUTE, "1s"))), openrouter: openRouterText("ok") });
    const lines = captureLogs();
    await gatewayFor().generate(chatRequest());

    const call = lines.find((line) => line.message === "AI call");
    expect(call?.data).toMatchObject({
      finalStatus: "success",
      provider: "openrouter",
      model: "vendor/served-free-model:free",
      fallback: true,
      fallbackReason: "GEMINI_RATE_LIMITED",
      providerHttpRequests: 3,
      retryCount: 1, // Gemini's one bounded retry
    });
    expect(typeof call?.data.latencyMs).toBe("number");
    expect(call?.data.attempts).toEqual([
      expect.objectContaining({ provider: "google", outcome: "error", status: 429, httpRequests: 2 }),
      expect.objectContaining({ provider: "openrouter", outcome: "ok", fallback: true }),
    ]);
    expect(lines.find((line) => line.message === "AI provider fallback")?.data).toMatchObject({
      fallbackReason: "GEMINI_RATE_LIMITED",
      from: { provider: "google", kind: "AI_PROVIDER_RATE_LIMIT", status: 429 },
      to: { provider: "openrouter" },
    });
  });

  it("the lines a real server writes keep every useful field: nothing is redacted by accident", async () => {
    // Asserted on the real console output (after redaction). A log field whose NAME contains a
    // sensitive word ("token", "pin", ...) would be silently replaced and an operator would lose it.
    stubProviders({ gemini: geminiFail(429, quotaBody(DAILY)), openrouter: openRouterText("ok") });
    const written: string[] = [];
    for (const method of ["log", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        written.push(String(args[0]));
      });
    }

    await withModelCallLog([], () => gatewayFor().generate(chatRequest()));

    const output = written.join("\n");
    expect(output).toContain("AI call");
    expect(output).not.toContain("[REDACTED]");
    for (const expected of ['"fallbackReason":"GEMINI_QUOTA_EXCEEDED"', '"provider":"openrouter"', '"retryCount":0', '"providerHttpRequests":2', '"finalStatus":"success"', '"latencyMs"', '"modelCallId"', '"attempts"']) {
      expect(output, expected).toContain(expected);
    }
  });

  it("a failed call logs the final status and error kind, and no key reaches the real log output", async () => {
    stubProviders({
      gemini: geminiFail(403, JSON.stringify({ error: { message: `API key not valid: ${GEMINI_KEY}` } })),
      openrouter: openRouterFail(401, `bad credentials ${OPENROUTER_KEY}`),
    });
    const out: string[] = [];
    for (const method of ["log", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        out.push(String(args[0]));
      });
    }

    await error(gatewayFor().generate(chatRequest()));
    // A second, fallback-eligible failure whose provider body echoes a key.
    stubProviders({
      gemini: geminiFail(503, `upstream said ${GEMINI_KEY}`),
      openrouter: openRouterFail(401, `bad credentials ${OPENROUTER_KEY}`),
    });
    await error(gatewayFor().generate(chatRequest()));

    const joined = out.join("\n");
    expect(joined).toContain("AI call failed");
    expect(joined).toContain("AI_PROVIDER_AUTH_ERROR");
    expect(joined).not.toContain(GEMINI_KEY);
    expect(joined).not.toContain(OPENROUTER_KEY);
    expect(joined).not.toMatch(/sk-or-v1-/);
  });
});

describe("ModelGateway: request economy (one user turn must not multiply model requests)", () => {
  it("N planner steps on a healthy provider send exactly N requests, all to Gemini, none hedged to OpenRouter", async () => {
    const stub = stubProviders({ gemini: geminiText("step"), openrouter: openRouterText("must not run") });
    const gateway = gatewayFor();
    for (let step = 0; step < 5; step += 1) await gateway.generate(chatRequest({ purpose: "planner", tools: [searchTool] }));

    expect(stub.gemini).toHaveLength(5);
    expect(stub.openrouter).toHaveLength(0);
  });

  it("two providers are never called at once: the fallback starts only after the primary has failed", async () => {
    const order: string[] = [];
    stubProviders({
      gemini: async () => {
        order.push("gemini:start");
        await Promise.resolve();
        order.push("gemini:end");
        return new Response(quotaBody(DAILY), { status: 429 });
      },
      openrouter: async () => {
        order.push("openrouter:start");
        return openRouterText("ok")({} as never);
      },
    });
    await gatewayFor().generate(chatRequest());

    expect(order).toEqual(["gemini:start", "gemini:end", "openrouter:start"]);
  });
});

describe("ModelGateway: status", () => {
  it("reports what is configured without a key, a URL or a secret", () => {
    const gateway = gatewayFor({ openRouterModelCapabilities: "tools,vision" });
    const status = gateway.getProviderStatus();

    expect(status.effective).toEqual({ mode: "live", primary: "google", fallback: "openrouter" });
    expect(status.providers.find((provider) => provider.id === "openrouter")?.models[0]).toMatchObject({
      model: "openrouter/free",
      free: true,
      capabilities: expect.arrayContaining(["text", "streaming", "tools", "vision"]),
    });
    expect(JSON.stringify(status)).not.toContain(GEMINI_KEY);
    expect(JSON.stringify(status)).not.toContain(OPENROUTER_KEY);
    expect(gateway.healthSummary()).toEqual({ provider: "google", fallback: true, fallbackTools: true });
  });

  it("says whether the fallback can take the planner's tool-using requests, and says nothing about it without a fallback", () => {
    // The default OpenRouter model declares no tool support (nothing is assumed): chat turns will not fall back.
    expect(gatewayFor().healthSummary()).toEqual({ provider: "google", fallback: true, fallbackTools: false });
    // Declaring the capability is what changes it.
    expect(gatewayFor({ openRouterModelCapabilities: "tools" }).healthSummary()).toEqual({ provider: "google", fallback: true, fallbackTools: true });
    // Vision alone does not help a chat turn.
    expect(gatewayFor({ openRouterModelCapabilities: "vision" }).healthSummary().fallbackTools).toBe(false);
    // With no fallback there is nothing to describe: the key is absent, not false.
    expect(gatewayFor({ openRouterApiKey: undefined }).healthSummary()).toEqual({ provider: "google", fallback: false });
    expect(gatewayFor({ aiFallbackProvider: "none" }).healthSummary()).toEqual({ provider: "google", fallback: false });
  });

  it("counts calls, fallbacks and failures by kind", async () => {
    stubProviders({ gemini: sequence(geminiFail(429, quotaBody(DAILY)), geminiText("ok")), openrouter: openRouterText("fb") });
    const gateway = gatewayFor({ aiQuotaCooldownMs: "0" });
    await gateway.generate(chatRequest());
    await gateway.generate(chatRequest());

    expect(gateway.getProviderStatus().counters).toMatchObject({ calls: 2, succeeded: 2, fallbacks: 1, failed: 0, failuresByKind: { AI_PROVIDER_QUOTA_EXCEEDED: 1 } });
  });
});
