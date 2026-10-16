import { afterEach, describe, expect, it, vi } from "vitest";
import { withModelCallLog, type ModelCallRecord } from "../../src/ai/callTrace.js";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import { createModelGateway } from "../../src/ai/providerFactory.js";
import { logger } from "../../src/security/redact.js";
import { DAILY, quotaBody } from "./geminiFixtures.js";
import {
  GEMINI_KEY,
  GROQ_KEYS,
  chatRequest,
  fakeEnv,
  geminiFail,
  geminiText,
  openRouterSse,
  openRouterText,
  searchTool,
  sequence,
  sseResponse,
  stubProviders,
  type RecordedCall,
  type Responder,
} from "./gatewayHarness.js";

/**
 * Groq as the first provider of the default chain, and several keys per provider (GROQ_KEYS=k1,k2,...):
 * the real adapters run, only `fetch` is stubbed. What must hold:
 * - the default order is Groq, OpenRouter, Gemini, OpenAI (a provider without a key is skipped);
 * - a key that is rate limited, out of quota or refused is replaced AT ONCE by the next key, inside the same
 *   provider, before the gateway falls back;
 * - an outage is not a key problem: no other key is tried, the next provider answers;
 * - the next request starts with the key that last worked; keys are named by slot in logs, never by value.
 */

// The retry policy's waits are covered in geminiErrors.test.ts; here they would only slow the tests.
vi.mock("../../src/ai/geminiErrors.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/ai/geminiErrors.js")>()),
  sleep: async () => {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The default order: nothing pins the primary. */
function gatewayFor(overrides: Parameters<typeof fakeEnv>[0] = {}, now?: () => number) {
  return createModelGateway(fakeEnv({ aiPrimaryProvider: undefined, ...overrides }), { isProduction: true, now });
}

const groqKeys = (count = 3): string[] => GROQ_KEYS.slice(0, count);
const bearer = (call: RecordedCall) => call.headers.authorization?.replace(/^Bearer /, "");

const groqText =
  (text: string): Responder =>
  () =>
    new Response(
      JSON.stringify({ id: "chatcmpl-groq-1", model: "openai/gpt-oss-120b", choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 3 } }),
      { status: 200 },
    );

/** Groq's own 429 bodies: the window is named in the message, and `retry-after` is sent. */
const groqRateLimited: Responder = () =>
  new Response(
    JSON.stringify({
      error: {
        message: "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7900, Requested 900. Please try again in 6.75s.",
        type: "tokens",
        code: "rate_limit_exceeded",
      },
    }),
    { status: 429, headers: { "retry-after": "7" } },
  );
const groqDailySpent: Responder = () =>
  new Response(
    JSON.stringify({
      error: {
        message: "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on requests per day (RPD): Limit 1000, Used 1000, Requested 1. Please try again in 1h2m.",
        type: "requests",
        code: "rate_limit_exceeded",
      },
    }),
    { status: 429 },
  );
const groqFail =
  (status: number, message = "error"): Responder =>
  () =>
    new Response(JSON.stringify({ error: { message, type: "invalid_request_error" } }), { status });

/** Answers per key: the responder for the key in the request's Authorization header. */
const byKey =
  (responders: Record<string, Responder>, otherwise: Responder = groqFail(500, "no responder for this key")): Responder =>
  (call) =>
    (responders[bearer(call) ?? ""] ?? otherwise)(call);

describe("the default provider order: Groq, OpenRouter, Gemini, OpenAI", () => {
  it("Groq answers first when it has a key: one request to Groq's endpoint with the plain OpenAI body", async () => {
    const stub = stubProviders({ groq: groqText("Fast answer."), gemini: geminiText("never"), openrouter: openRouterText("never") });
    const response = await gatewayFor({ groqKeys: [GROQ_KEYS[0]] }).generate(chatRequest());

    expect(response.message.content).toBe("Fast answer.");
    expect(response.meta).toMatchObject({ provider: "groq", model: "openai/gpt-oss-120b", fallback: false, attempts: 1 });
    expect(stub.groq).toHaveLength(1);
    expect(stub.gemini).toHaveLength(0);
    expect(stub.openrouter).toHaveLength(0);
    const [call] = stub.groq;
    expect(call!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(bearer(call!)).toBe(GROQ_KEYS[0]);
    expect(call!.body).toMatchObject({ model: "openai/gpt-oss-120b", stream: false });
    // No OpenRouter extensions: Groq would reject or ignore them.
    expect(call!.body.models).toBeUndefined();
    expect(call!.body.provider).toBeUndefined();
    expect(call!.headers["http-referer"]).toBeUndefined();
  });

  it("Groq's model takes tool-using planner turns (it declares tools)", async () => {
    const stub = stubProviders({
      groq: () =>
        new Response(
          JSON.stringify({ id: "c", model: "openai/gpt-oss-120b", choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "web-search", arguments: '{"query":"rivers"}' } }] } }] }),
          { status: 200 },
        ),
    });
    const response = await gatewayFor({ groqKeys: [GROQ_KEYS[0]] }).generate(chatRequest({ purpose: "planner", tools: [searchTool] }));
    expect(response.toolCalls).toEqual([{ id: "t1", skillId: "web.search", input: { query: "rivers" } }]);
    expect(stub.groq[0]!.body.tools[0].function.name).toBe("web-search");
  });

  it("without a Groq key, OpenRouter answers a plain request first, ahead of Gemini", async () => {
    const stub = stubProviders({ openrouter: openRouterText("Router answer."), gemini: geminiText("never") });
    const response = await gatewayFor().generate(chatRequest());
    expect(response.meta).toMatchObject({ provider: "openrouter", fallback: false });
    expect(stub.gemini).toHaveLength(0);
  });

  it("a tool-using turn skips the free OpenRouter model (no tools declared) and Gemini answers it", async () => {
    const stub = stubProviders({ gemini: geminiText("Gemini planned."), openrouter: openRouterText("never") });
    const response = await gatewayFor().generate(chatRequest({ purpose: "planner", tools: [searchTool] }));
    expect(response.meta).toMatchObject({ provider: "google", fallback: true, fallbackReason: "OPENROUTER_CAPABILITY_UNSUPPORTED" });
    expect(stub.openrouter).toHaveLength(0);
  });

  it("when every Groq key is spent, the request moves down the chain to the next provider", async () => {
    const stub = stubProviders({ groq: groqDailySpent, openrouter: openRouterText("Backup answer.") });
    const log: ModelCallRecord[] = [];
    const response = await withModelCallLog(log, () => gatewayFor({ groqKeys: groqKeys(2) }).generate(chatRequest()));

    expect(response.message.content).toBe("Backup answer.");
    expect(response.meta).toMatchObject({ provider: "openrouter", fallback: true, fallbackReason: "GROQ_QUOTA_EXCEEDED" });
    // Each key once (a daily quota is never retried on the same key), then one OpenRouter request.
    expect(stub.groq.map(bearer)).toEqual([GROQ_KEYS[0], GROQ_KEYS[1]]);
    expect(stub.openrouter).toHaveLength(1);
    expect(log.map((record) => [record.provider, record.keySlot, record.outcome])).toEqual([
      ["groq", 1, "error"],
      ["groq", 2, "error"],
      ["openrouter", undefined, "ok"],
    ]);
  });
});

describe("several keys for one provider", () => {
  it("a rate-limited key is replaced at once by the next key: no wait on the limited key, no fallback", async () => {
    const stub = stubProviders({ groq: byKey({ [GROQ_KEYS[0]]: groqRateLimited, [GROQ_KEYS[1]]: groqText("Second key answered.") }) });
    const gateway = gatewayFor({ groqKeys: groqKeys(3) });

    const response = await gateway.generate(chatRequest());
    expect(response.message.content).toBe("Second key answered.");
    expect(response.meta).toMatchObject({ provider: "groq", fallback: false, attempts: 1 });
    // The short advised wait was NOT spent retrying key 1: another key could take the request right away.
    expect(stub.groq.map(bearer)).toEqual([GROQ_KEYS[0], GROQ_KEYS[1]]);

    // The next request starts with the key that worked.
    await gateway.generate(chatRequest());
    expect(stub.groq.map(bearer).slice(2)).toEqual([GROQ_KEYS[1]]);
    const keys = gateway.getProviderStatus().providers.find((provider) => provider.id === "groq")!.keys!;
    expect(keys).toMatchObject({ total: 3, available: 2, activeSlot: 2, rotations: 1 });
    expect(keys.slots[0]).toMatchObject({ slot: 1, state: "cooling", reason: "rate_limited" });
  });

  it("a key whose daily quota is spent rests; the request and the ones after it use the next key", async () => {
    const stub = stubProviders({ groq: byKey({ [GROQ_KEYS[0]]: groqDailySpent, [GROQ_KEYS[1]]: groqText("ok") }) });
    const gateway = gatewayFor({ groqKeys: groqKeys(2) });
    await gateway.generate(chatRequest());
    await gateway.generate(chatRequest());
    expect(stub.groq.map(bearer)).toEqual([GROQ_KEYS[0], GROQ_KEYS[1], GROQ_KEYS[1]]);
  });

  it("a refused key (401) is skipped for the next one, and /health still names the provider so the dead key is fixed", async () => {
    const stub = stubProviders({ groq: byKey({ [GROQ_KEYS[0]]: groqFail(401, "Invalid API Key"), [GROQ_KEYS[1]]: groqText("ok") }) });
    const gateway = gatewayFor({ groqKeys: groqKeys(2) });

    const response = await gateway.generate(chatRequest());
    expect(response.meta).toMatchObject({ provider: "groq", fallback: false });
    expect(stub.groq.map(bearer)).toEqual([GROQ_KEYS[0], GROQ_KEYS[1]]);
    expect(gateway.healthSummary().authRejected).toEqual(["groq"]);
    const keys = gateway.getProviderStatus().providers.find((provider) => provider.id === "groq")!.keys!;
    expect(keys.slots.map((slot) => slot.state)).toEqual(["rejected", "ready"]);
  });

  it("an outage is the same for every key: no other key is tried, the next provider answers", async () => {
    const stub = stubProviders({ groq: groqFail(503, "Service Unavailable"), openrouter: openRouterText("Backup.") });
    const response = await gatewayFor({ groqKeys: groqKeys(3) }).generate(chatRequest());

    expect(response.meta).toMatchObject({ provider: "openrouter", fallback: true, fallbackReason: "GROQ_UNAVAILABLE" });
    // The shared retry policy's bounded retries, all on the first key; keys 2 and 3 are never asked.
    expect(new Set(stub.groq.map(bearer))).toEqual(new Set([GROQ_KEYS[0]]));
    expect(stub.groq).toHaveLength(3);
  });

  it("a refused request is not a key problem either: it fails once, on one key, with no fallback", async () => {
    const stub = stubProviders({ groq: groqFail(400, "bad request"), openrouter: openRouterText("never") });
    const failure = await gatewayFor({ groqKeys: groqKeys(3) }).generate(chatRequest()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AIProviderError);
    expect((failure as AIProviderError).kind).toBe("AI_PROVIDER_INVALID_REQUEST");
    expect(stub.groq).toHaveLength(1);
    expect(stub.openrouter).toHaveLength(0);
  });

  it("with a single key, a short rate limit is still waited out and retried once on that key (unchanged)", async () => {
    const stub = stubProviders({ groq: sequence(groqRateLimited, groqText("after the wait")) });
    const response = await gatewayFor({ groqKeys: [GROQ_KEYS[0]] }).generate(chatRequest());
    expect(response.message.content).toBe("after the wait");
    expect(stub.groq.map(bearer)).toEqual([GROQ_KEYS[0], GROQ_KEYS[0]]);
  });

  it("while every key rests, the one that recovers first is still asked (one request), not refused unasked", async () => {
    let now = 1_000_000;
    const stub = stubProviders({ groq: groqDailySpent, openrouter: openRouterText("Backup.") });
    const gateway = gatewayFor({ groqKeys: groqKeys(2), aiQuotaCooldownMs: "0" }, () => now);
    await gateway.generate(chatRequest());
    expect(stub.groq).toHaveLength(2);

    now += 1_000;
    await gateway.generate(chatRequest());
    // One more Groq request (the soonest key), then the fallback.
    expect(stub.groq).toHaveLength(3);
    expect(stub.openrouter).toHaveLength(2);
  });

  it("Gemini rotates too: a key whose models all spent their daily quota hands over to the next key", async () => {
    const second = "gemini-test-key-ZZZZ9999";
    const stub = stubProviders({
      gemini: (call) => (call.headers["x-goog-api-key"] === GEMINI_KEY ? geminiFail(429, quotaBody(DAILY))(call) : geminiText("second Gemini key")(call)),
    });
    const response = await gatewayFor({ aiPrimaryProvider: "gemini", aiFallbackProvider: "none", geminiKeys: [GEMINI_KEY, second] }).generate(chatRequest());

    expect(response.message.content).toBe("second Gemini key");
    // Key 1: both of its models (each has its own free-tier quota), then key 2.
    expect(stub.gemini.map((call) => call.headers["x-goog-api-key"])).toEqual([GEMINI_KEY, GEMINI_KEY, second]);
  });

  it("the single-key variable is added after the list, each key once", async () => {
    const stub = stubProviders({ groq: byKey({ [GROQ_KEYS[0]]: groqDailySpent, [GROQ_KEYS[1]]: groqDailySpent, [GROQ_KEYS[2]]: groqText("legacy key") }) });
    const response = await gatewayFor({ groqKeys: [GROQ_KEYS[0], GROQ_KEYS[1]], groqApiKey: GROQ_KEYS[2] }).generate(chatRequest());
    expect(response.message.content).toBe("legacy key");
    expect(stub.groq.map(bearer)).toEqual([...GROQ_KEYS]);
  });

  it("logs a rotation by slot and never writes a key", async () => {
    const lines: string[] = [];
    const capture = (message: string, data?: Record<string, unknown>) => void lines.push(JSON.stringify({ message, data }));
    vi.spyOn(logger, "info").mockImplementation(capture);
    vi.spyOn(logger, "warn").mockImplementation(capture);
    stubProviders({ groq: byKey({ [GROQ_KEYS[0]]: groqRateLimited, [GROQ_KEYS[1]]: groqText("ok") }) });

    await gatewayFor({ groqKeys: groqKeys(2) }).generate(chatRequest());

    const all = lines.join("\n");
    for (const key of GROQ_KEYS) expect(all).not.toContain(key);
    expect(all).toContain('"message":"API key resting; the next key takes over"');
    expect(all).toContain('"message":"API key rotated"');
    const call = lines.map((line) => JSON.parse(line)).find((line) => line.message === "AI call");
    expect(call.data.attempts.map((attempt: { keySlot?: number; outcome: string }) => [attempt.keySlot, attempt.outcome])).toEqual([
      [1, "error"],
      [2, "ok"],
    ]);
  });
});

describe("streaming with several keys", () => {
  it("before any text, a rate-limited key hands the stream to the next key", async () => {
    const stub = stubProviders({
      groq: byKey({ [GROQ_KEYS[0]]: groqRateLimited, [GROQ_KEYS[1]]: () => sseResponse([openRouterSse("Hello "), openRouterSse("there."), "data: [DONE]\n\n"]) }),
    });
    const chunks: string[] = [];
    let meta: unknown;
    for await (const chunk of gatewayFor({ groqKeys: groqKeys(2) }).streamText(chatRequest())) {
      chunks.push(chunk.delta);
      if (chunk.done) meta = chunk.meta;
    }
    expect(chunks.join("")).toBe("Hello there.");
    expect(meta).toMatchObject({ provider: "groq", fallback: false });
    expect(stub.groq.map(bearer)).toEqual([GROQ_KEYS[0], GROQ_KEYS[1]]);
    expect(stub.groq[1]!.body.stream).toBe(true);
  });

  it("the key that streamed the answer becomes the active key, like a plain call's", async () => {
    const stub = stubProviders({
      groq: byKey({
        [GROQ_KEYS[0]]: groqRateLimited,
        [GROQ_KEYS[1]]: (call) => (call.body.stream ? sseResponse([openRouterSse("Streamed."), "data: [DONE]\n\n"]) : groqText("Plain.")(call)),
      }),
    });
    const gateway = gatewayFor({ groqKeys: groqKeys(2) });
    for await (const _chunk of gateway.streamText(chatRequest())) void _chunk;

    // The gateway stops reading at the provider's final chunk; the rotation must already be recorded by then.
    const keys = gateway.getProviderStatus().providers.find((provider) => provider.id === "groq")!.keys!;
    expect(keys).toMatchObject({ activeSlot: 2, rotations: 1 });
    await gateway.generate(chatRequest());
    expect(stub.groq.map(bearer)).toEqual([GROQ_KEYS[0], GROQ_KEYS[1], GROQ_KEYS[1]]);
  });

  it("once text was delivered, a failure is not restarted on another key", async () => {
    const stub = stubProviders({
      groq: () => sseResponse([openRouterSse("Partial ")], { failAfter: Object.assign(new TypeError("terminated"), { cause: new Error("socket hang up") }) }),
    });
    const chunks: string[] = [];
    const failure = await (async () => {
      for await (const chunk of gatewayFor({ groqKeys: groqKeys(2) }).streamText(chatRequest())) chunks.push(chunk.delta);
    })().catch((error: unknown) => error);
    expect(chunks.join("")).toBe("Partial ");
    expect(failure).toBeInstanceOf(AIProviderError);
    expect(stub.groq).toHaveLength(1);
  });
});
