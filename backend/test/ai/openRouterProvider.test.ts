import { afterEach, describe, expect, it, vi } from "vitest";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import { OpenRouterProvider } from "../../src/ai/openRouterProvider.js";
import type { AIRequest } from "../../src/ai/provider.js";
import { OPENROUTER_KEY, openRouterFail, openRouterSse, openRouterText, searchTool, sequence, sseResponse, stubProviders } from "./gatewayHarness.js";

vi.mock("../../src/ai/geminiErrors.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/ai/geminiErrors.js")>()),
  sleep: async () => {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const request = (overrides: Partial<AIRequest> = {}): AIRequest => ({
  systemPrompt: "You are ZARVIS.",
  messages: [{ role: "user", content: "hello" }],
  modelConfig: { provider: "openrouter", model: "openrouter/free" },
  ...overrides,
});
const provider = (options: Partial<ConstructorParameters<typeof OpenRouterProvider>[0]> = {}) => new OpenRouterProvider({ apiKey: OPENROUTER_KEY, ...options });
const error = async (promise: Promise<unknown>) => (await promise.then(() => undefined, (e: unknown) => e)) as AIProviderError;

describe("OpenRouterProvider request", () => {
  it("posts an OpenAI-compatible chat completion with the key only in the Authorization header", async () => {
    const stub = stubProviders({ openrouter: openRouterText("hi") });
    await provider().generate(request({ modelConfig: { provider: "openrouter", model: "openrouter/free", temperature: 0.2, maxTokens: 900 } }));

    const call = stub.openrouter[0]!;
    expect(call.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(call.method).toBe("POST");
    expect(call.headers).toMatchObject({ authorization: `Bearer ${OPENROUTER_KEY}`, "content-type": "application/json", "http-referer": "https://zarvismobile.com", "x-title": "ZARVIS" });
    expect(call.url).not.toContain(OPENROUTER_KEY);
    expect(JSON.stringify(call.body)).not.toContain(OPENROUTER_KEY);
    expect(call.body).toEqual({
      model: "openrouter/free",
      messages: [
        { role: "system", content: "You are ZARVIS." },
        { role: "user", content: "hello" },
      ],
      stream: false,
      max_tokens: 900,
      temperature: 0.2,
    });
  });

  it("asks for a bounded output by default, omits temperature unless set, and sends neither tools nor routing hints without need", async () => {
    const stub = stubProviders({ openrouter: openRouterText("hi") });
    await provider().generate(request());

    expect(stub.openrouter[0]!.body).toMatchObject({ max_tokens: 4096 });
    expect(stub.openrouter[0]!.body).not.toHaveProperty("temperature");
    expect(stub.openrouter[0]!.body).not.toHaveProperty("tools");
    expect(stub.openrouter[0]!.body).not.toHaveProperty("provider");
    expect(stub.openrouter[0]!.body).not.toHaveProperty("response_format");
  });

  it("passes history, labels tool results as user turns (no tool_call linkage exists), and drops system-role messages", async () => {
    const stub = stubProviders({ openrouter: openRouterText("ok") });
    await provider().generate(
      request({
        messages: [
          { role: "system", content: "ignored: systemPrompt is the only system channel" },
          { role: "user", content: "find phones" },
          { role: "assistant", content: "searching" },
          { role: "tool", content: '{"skillId":"web.search","success":true}' },
        ],
      }),
    );

    expect(stub.openrouter[0]!.body.messages).toEqual([
      { role: "system", content: "You are ZARVIS." },
      { role: "user", content: "find phones" },
      { role: "assistant", content: "searching" },
      { role: "user", content: '[Tool result] {"skillId":"web.search","success":true}' },
    ]);
  });

  it("uses a configured base URL (trailing slash tolerated) and reads the key at request time", async () => {
    const stub = stubProviders({ openrouter: openRouterText("ok") }, ["proxy.example.com"]);
    let key = "first-key-0000000000";
    const rotating = provider({ apiKey: () => key, baseUrl: "https://proxy.example.com/openrouter/v1/" });

    await rotating.generate(request());
    key = "second-key-1111111111";
    await rotating.generate(request());

    expect(stub.calls.map((call) => call.url)).toEqual(Array(2).fill("https://proxy.example.com/openrouter/v1/chat/completions"));
    expect(stub.calls.map((call) => call.headers.authorization)).toEqual(["Bearer first-key-0000000000", "Bearer second-key-1111111111"]);
  });

  it("the harness routes by the parsed host name, so a look-alike URL is never mistaken for a provider", async () => {
    // These tests prove the key only goes to the right host. A provider's name inside a path, a
    // query or a longer host name must therefore not be answered by that provider's stub.
    const stub = stubProviders({ gemini: () => new Response("never"), openrouter: openRouterText("never") });
    const lookalikes = [
      "https://evil.example/generativelanguage.googleapis.com/v1",
      "https://generativelanguage.googleapis.com.evil.example/v1",
      "https://evil.example/?next=openrouter.ai",
      "https://openrouter.ai.evil.example/api/v1",
    ];
    for (const url of lookalikes) await expect(fetch(url)).rejects.toThrow(/unexpected request to other/);

    expect(stub.calls.map((call) => call.host)).toEqual(Array(lookalikes.length).fill("other"));
    expect(stub.gemini).toHaveLength(0);
    expect(stub.openrouter).toHaveLength(0);
  });

  it("without a key it fails before any request, non-retryably", async () => {
    const stub = stubProviders({ openrouter: openRouterText("never") });
    const failure = await error(provider({ apiKey: () => undefined }).generate(request()));

    expect(failure).toMatchObject({ provider: "openrouter", retryable: false, code: "AI_UNAVAILABLE" });
    expect(stub.calls).toHaveLength(0);
  });

  it("refuses two tools that would share one provider function name instead of mixing them up", async () => {
    stubProviders({ openrouter: openRouterText("never") });
    const failure = await error(provider().generate(request({ tools: [{ ...searchTool, name: "a.b-c" }, { ...searchTool, name: "a-b.c" }] })));

    expect(failure.kind).toBe("AI_INTERNAL_ERROR");
  });
});

describe("OpenRouterProvider response", () => {
  it("returns text, usage, the model that actually served, and the response id for tracing", async () => {
    stubProviders({ openrouter: openRouterText("Namaste", "vendor/chosen-by-router:free") });
    const trace = { httpRequests: 0, responseIds: [] as string[], servedModels: [] as string[] };
    const response = await provider().generate(request({ trace }));

    expect(response.message).toEqual({ role: "assistant", content: "Namaste" });
    expect(response.usage).toEqual({ promptTokens: 11, completionTokens: 4 });
    expect(trace).toEqual({ httpRequests: 1, responseIds: ["gen-or-1"], servedModels: ["vendor/chosen-by-router:free"] });
  });

  it("a null content with no tool call is an empty answer, not a crash", async () => {
    stubProviders({ openrouter: () => new Response(JSON.stringify({ choices: [{ message: { content: null }, finish_reason: "content_filter" }] }), { status: 200 }) });
    const response = await provider().generate(request());
    expect(response.message.content).toBe("");
    expect(response.toolCalls).toEqual([]);
  });

  it("a 200 that is not JSON is a provider failure", async () => {
    stubProviders({ openrouter: () => new Response("<html>gateway error</html>", { status: 200 }) });
    expect(await error(provider().generate(request()))).toMatchObject({ kind: "AI_PROVIDER_UNAVAILABLE", retryable: true });
  });
});

describe("OpenRouterProvider retries and timeouts (one shared policy)", () => {
  it("retries a transient 503 twice, counting every request, then reports it", async () => {
    const stub = stubProviders({ openrouter: openRouterFail(503, "overloaded") });
    const trace = { httpRequests: 0, responseIds: [] as string[] };
    const failure = await error(provider().generate(request({ trace })));

    expect(stub.openrouter).toHaveLength(3);
    expect(trace.httpRequests).toBe(3);
    expect(failure).toMatchObject({ kind: "AI_PROVIDER_UNAVAILABLE", retryable: true, status: 503 });
  });

  it("recovers when a retry succeeds, and reports the real request count", async () => {
    const stub = stubProviders({ openrouter: sequence(openRouterFail(502, "bad gateway"), openRouterText("second time lucky")) });
    const trace = { httpRequests: 0, responseIds: [] as string[] };
    const response = await provider().generate(request({ trace }));

    expect(response.message.content).toBe("second time lucky");
    expect(stub.openrouter).toHaveLength(2);
    expect(trace.httpRequests).toBe(2);
  });

  it("does not retry a rejected key, a bad request, an empty balance or a missing model", async () => {
    for (const status of [400, 401, 402, 404]) {
      const stub = stubProviders({ openrouter: openRouterFail(status, "no") });
      await error(provider().generate(request()));
      expect(stub.openrouter).toHaveLength(1);
    }
  });

  it("retries a network failure a bounded number of times", async () => {
    const stub = stubProviders({
      openrouter: () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
      },
    });
    const failure = await error(provider().generate(request()));

    expect(stub.openrouter).toHaveLength(3);
    expect(failure).toMatchObject({ kind: "AI_PROVIDER_UNAVAILABLE", retryable: true, message: expect.stringContaining("ENOTFOUND") });
  });

  it("a request that outlives its time budget is a structured timeout and is NOT retried", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stub = stubProviders({
      openrouter: (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    });
    const pending = error(provider({ timeoutMs: 5_000 }).generate(request()));
    await vi.advanceTimersByTimeAsync(5_001);
    const failure = await pending;

    expect(failure).toMatchObject({ kind: "AI_PROVIDER_TIMEOUT", code: "AI_UNAVAILABLE", retryable: true, message: "OpenRouter request timed out" });
    expect(stub.openrouter).toHaveLength(1);
  });

  it("a cancelled turn aborts the request and is never reported as a provider failure", async () => {
    const controller = new AbortController();
    stubProviders({
      openrouter: () => {
        controller.abort();
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
    });
    const failure = await error(provider().generate(request({ signal: controller.signal })));
    expect(failure.name).toBe("AbortError");
  });
});

describe("OpenRouterProvider streaming", () => {
  it("parses data lines across chunk boundaries, ignores comments, stops at [DONE]", async () => {
    const whole = openRouterSse("Hel") + ": keep-alive\n\n" + openRouterSse("lo");
    const cut = whole.indexOf("lo\"") + 1; // split in the middle of a JSON payload
    stubProviders({ openrouter: () => sseResponse([whole.slice(0, cut), whole.slice(cut), "data: [DONE]\n\n", openRouterSse("never read")]) });
    const text: string[] = [];
    for await (const chunk of provider().streamGenerate(request())) text.push(chunk.delta);

    expect(text.join("")).toBe("Hello");
  });

  it("a mid-stream error object ends the stream as a structured failure", async () => {
    stubProviders({ openrouter: () => sseResponse([openRouterSse("partial "), `data: ${JSON.stringify({ error: { code: 429, message: "Rate limit exceeded: free-models-per-day." } })}\n\n`]) });
    const seen: string[] = [];
    const failure = await error(
      (async () => {
        for await (const chunk of provider().streamGenerate(request())) seen.push(chunk.delta);
      })(),
    );

    expect(seen).toEqual(["partial "]);
    expect(failure).toMatchObject({ kind: "AI_PROVIDER_QUOTA_EXCEEDED", code: "AI_QUOTA_EXCEEDED" });
  });

  it("refuses a streamed request with tools instead of losing the tool calls", async () => {
    const stub = stubProviders({ openrouter: openRouterText("never") });
    const failure = await error(
      (async () => {
        for await (const _chunk of provider().streamGenerate(request({ tools: [searchTool] }))) {
          // nothing expected
        }
      })(),
    );
    expect(failure.kind).toBe("AI_PROVIDER_CAPABILITY_UNSUPPORTED");
    expect(stub.calls).toHaveLength(0);
  });
});
