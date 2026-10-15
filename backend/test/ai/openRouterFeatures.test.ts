import { afterEach, describe, expect, it, vi } from "vitest";
import { withModelCallLog, type ModelCallRecord } from "../../src/ai/callTrace.js";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import { OpenRouterProvider } from "../../src/ai/openRouterProvider.js";
import type { AIRequest } from "../../src/ai/provider.js";
import { OPENROUTER_KEY, openRouterSse, openRouterText, searchTool, sseResponse, stubProviders } from "./gatewayHarness.js";

vi.mock("../../src/ai/geminiErrors.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/ai/geminiErrors.js")>()),
  sleep: async () => {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const request = (overrides: Partial<AIRequest> = {}, modelConfig: Partial<AIRequest["modelConfig"]> = {}): AIRequest => ({
  systemPrompt: "You are ZARVIS.",
  messages: [{ role: "user", content: "hello" }],
  modelConfig: { provider: "openrouter", model: "vendor/main:free", ...modelConfig },
  ...overrides,
});
const provider = (options: Partial<ConstructorParameters<typeof OpenRouterProvider>[0]> = {}) => new OpenRouterProvider({ apiKey: OPENROUTER_KEY, ...options });
const failure = async (promise: Promise<unknown>) => (await promise.then(() => undefined, (e: unknown) => e)) as AIProviderError;

describe("OpenRouter: models named for the same request (server-side fallback)", () => {
  it("sends the alternates in OpenRouter's `models` array, in order, and no `model`", async () => {
    const stub = stubProviders({ openrouter: openRouterText("hi") });
    await provider().generate(request({}, { fallbackModels: ["vendor/second:free", "openrouter/free"] }));

    const body = stub.openrouter[0]!.body;
    expect(body.models).toEqual(["vendor/main:free", "vendor/second:free", "openrouter/free"]);
    expect(body).not.toHaveProperty("model");
    // One HTTP request for all of them: a retired model costs no extra request of ours.
    expect(stub.openrouter).toHaveLength(1);
  });

  it("drops duplicates and keeps to OpenRouter's limit of three", async () => {
    const stub = stubProviders({ openrouter: openRouterText("hi") });
    await provider().generate(request({}, { fallbackModels: ["vendor/main:free", "a/b", "c/d", "e/f"] }));
    expect(stub.openrouter[0]!.body.models).toEqual(["vendor/main:free", "a/b", "c/d"]);
  });

  it("sends a plain `model` when there is nothing to fall back to", async () => {
    const stub = stubProviders({ openrouter: openRouterText("hi") });
    await provider().generate(request({}, { fallbackModels: ["vendor/main:free"] }));
    expect(stub.openrouter[0]!.body.model).toBe("vendor/main:free");
    expect(stub.openrouter[0]!.body).not.toHaveProperty("models");
  });

  it("records the model that really answered (a router or a later alternate), not the first one named", async () => {
    stubProviders({ openrouter: openRouterText("hi", "vendor/second:free") });
    const records: ModelCallRecord[] = [];
    await withModelCallLog(records, () => provider().generate(request({}, { fallbackModels: ["vendor/second:free"] })));
    expect(records[0]).toMatchObject({ configuredModel: "vendor/main:free", servedModel: "vendor/second:free", outcome: "ok" });
  });

  it("names the alternates for an image analysis too", async () => {
    const stub = stubProviders({ openrouter: openRouterText("a red door") });
    await provider().analyzeImage({ data: Buffer.from("png"), mimeType: "image/png", modelConfig: { provider: "openrouter", model: "vendor/eyes:free", fallbackModels: ["vendor/eyes2:free"] } });
    expect(stub.openrouter[0]!.body.models).toEqual(["vendor/eyes:free", "vendor/eyes2:free"]);
    expect(stub.openrouter[0]!.body.messages[1].content[1]).toMatchObject({ type: "image_url" });
  });
});

describe("OpenRouter: cost and data controls (the operator's policy)", () => {
  it("sends the price ceiling and the data-collection choice as provider preferences", async () => {
    const stub = stubProviders({ openrouter: openRouterText("hi") });
    await provider({ policy: { dataCollection: "deny", maxPricePromptPerM: 0.5, maxPriceCompletionPerM: 2 } }).generate(request());

    expect(stub.openrouter[0]!.body.provider).toEqual({ data_collection: "deny", max_price: { prompt: 0.5, completion: 2 } });
  });

  it("combines them with require_parameters when tools are sent, and omits `provider` when nothing applies", async () => {
    const stub = stubProviders({ openrouter: openRouterText("hi") });
    await provider({ policy: { dataCollection: "allow" } }).generate(request({ tools: [searchTool] }));
    expect(stub.openrouter[0]!.body.provider).toEqual({ require_parameters: true, data_collection: "allow" });

    await provider().generate(request());
    expect(stub.openrouter[1]!.body).not.toHaveProperty("provider");
  });

  it("caps the output length whatever the caller asked for, for chat and for image analysis", async () => {
    const stub = stubProviders({ openrouter: openRouterText("hi") });
    const capped = provider({ policy: { maxOutputTokens: 256 } });
    await capped.generate(request({}, { maxTokens: 8000 }));
    await capped.generate(request());
    await capped.analyzeImage({ data: Buffer.from("png"), mimeType: "image/png", modelConfig: { provider: "openrouter", model: "vendor/eyes:free" } });
    await provider({ policy: { maxOutputTokens: 100_000 } }).generate(request({}, { maxTokens: 900 }));

    expect(stub.openrouter.map((call) => call.body.max_tokens)).toEqual([256, 256, 256, 900]);
  });

  it("reads the tokens and the cost OpenRouter reports onto the response and the call record", async () => {
    stubProviders({
      openrouter: () =>
        new Response(
          JSON.stringify({ id: "gen-1", model: "vendor/main:free", choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.00042 } }),
          { status: 200 },
        ),
    });
    const records: ModelCallRecord[] = [];
    const response = await withModelCallLog(records, () => provider().generate(request()));

    expect(response.usage).toEqual({ promptTokens: 120, completionTokens: 30, costUsd: 0.00042 });
    expect(records[0]).toMatchObject({ promptTokens: 120, completionTokens: 30, costUsd: 0.00042 });
  });

  it("reports no cost when OpenRouter gives none or gives something that is not a cost", async () => {
    stubProviders({
      openrouter: () =>
        new Response(JSON.stringify({ id: "g", choices: [{ message: { role: "assistant", content: "hi" } }], usage: { prompt_tokens: 3, completion_tokens: 2, cost: -5 } }), { status: 200 }),
    });
    const response = await provider().generate(request());
    expect(response.usage).toEqual({ promptTokens: 3, completionTokens: 2 });
  });

  it("reads the final usage chunk of a stream", async () => {
    stubProviders({
      openrouter: () =>
        sseResponse([
          ": OPENROUTER PROCESSING\n\n",
          openRouterSse("Hel"),
          openRouterSse("lo"),
          `data: ${JSON.stringify({ id: "gen-s", choices: [], usage: { prompt_tokens: 9, completion_tokens: 2, cost: 0.0001 } })}\n\n`,
          "data: [DONE]\n\n",
        ]),
    });
    const records: ModelCallRecord[] = [];
    const chunks = await withModelCallLog(records, async () => {
      const collected: string[] = [];
      for await (const chunk of provider().streamGenerate(request())) collected.push(chunk.delta);
      return collected;
    });
    expect(chunks.join("")).toBe("Hello");
    expect(records[0]).toMatchObject({ promptTokens: 9, completionTokens: 2, costUsd: 0.0001 });
  });
});

describe("OpenRouter: structured outputs", () => {
  const schema = { type: "object", properties: { city: { type: "string" } }, required: ["city"], additionalProperties: false };

  it("asks for JSON mode with `response_format: json_object`, and requires a provider that supports it", async () => {
    const stub = stubProviders({ openrouter: openRouterText('{"a":1}') });
    await provider().generate(request({ responseFormat: "json" }));

    expect(stub.openrouter[0]!.body.response_format).toEqual({ type: "json_object" });
    expect(stub.openrouter[0]!.body.provider).toEqual({ require_parameters: true });
  });

  it("asks for a JSON Schema with `json_schema` (strict unless told otherwise)", async () => {
    const stub = stubProviders({ openrouter: openRouterText('{"city":"Pune"}') });
    await provider().generate(request({ responseFormat: { type: "json_schema", name: "place", schema } }));
    await provider().generate(request({ responseFormat: { type: "json_schema", name: "place", schema, strict: false } }));

    expect(stub.openrouter[0]!.body.response_format).toEqual({ type: "json_schema", json_schema: { name: "place", strict: true, schema } });
    expect(stub.openrouter[1]!.body.response_format.json_schema.strict).toBe(false);
    expect(stub.openrouter[0]!.body.provider).toEqual({ require_parameters: true });
  });

  it("declares that it can carry a schema (the gateway still needs a model that declares it)", () => {
    expect(provider().supportsJsonSchema).toBe(true);
  });
});

describe("OpenRouter: tool calling", () => {
  it("requires providers that support tools, and maps the model's call back to the skill id", async () => {
    const stub = stubProviders({
      openrouter: () =>
        new Response(
          JSON.stringify({
            id: "gen-t",
            model: "vendor/main:free",
            choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_9", type: "function", function: { name: "web-search", arguments: '{"query":"rain in Pune"}' } }] }, finish_reason: "tool_calls" }],
          }),
          { status: 200 },
        ),
    });
    const response = await provider().generate(request({ tools: [searchTool] }));

    expect(stub.openrouter[0]!.body.provider).toEqual({ require_parameters: true });
    expect(stub.openrouter[0]!.body.tools[0].function.name).toBe("web-search");
    expect(response.toolCalls).toEqual([{ id: "call_9", skillId: "web.search", input: { query: "rain in Pune" } }]);
  });
});

describe("OpenRouter: streaming limits", () => {
  it("gives up on a stream that goes silent, as a structured timeout (and cancels it)", async () => {
    let cancelled = false;
    stubProviders({
      openrouter: () => {
        const encoder = new TextEncoder();
        let sent = false;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!sent) {
                sent = true;
                controller.enqueue(encoder.encode(openRouterSse("start")));
                return;
              }
              return new Promise(() => {}); // never answers again
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    const received: string[] = [];
    const caught = await failure(
      (async () => {
        for await (const chunk of provider({ streamIdleTimeoutMs: 40 }).streamGenerate(request())) received.push(chunk.delta);
      })(),
    );

    expect(received).toEqual(["start"]);
    expect(caught).toBeInstanceOf(AIProviderError);
    expect(caught.kind).toBe("AI_PROVIDER_TIMEOUT");
    expect(cancelled).toBe(true);
  });

  it("a 200 whose body never finishes is a timeout, not a hang", async () => {
    stubProviders({
      openrouter: (call) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              // The body ends in an abort when the request's own time limit fires.
              call.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
            },
          }),
          { status: 200 },
        ),
    });
    const caught = await failure(provider({ timeoutMs: 40 }).generate(request()));
    expect(caught).toBeInstanceOf(AIProviderError);
    expect(caught.kind).toBe("AI_PROVIDER_TIMEOUT");
  });
});

describe("OpenRouter: the key and the connection", () => {
  it("refuses a key that cannot be a key before sending anything, and says nothing about its content", async () => {
    const stub = stubProviders({ openrouter: openRouterText("never") });
    const caught = await failure(provider({ apiKey: "sk-or-v1-abcdefghij\nklmnop" }).generate(request()));

    expect(stub.openrouter).toHaveLength(0);
    expect(caught).toBeInstanceOf(AIProviderError);
    expect(caught.kind).toBe("AI_PROVIDER_AUTH_ERROR");
    expect(caught.retryable).toBe(false);
    expect(caught.message).not.toContain("abcdefghij");
    expect(JSON.stringify(caught)).not.toContain("klmnop");
  });

  it("accepts the keys OpenRouter really issues", async () => {
    const stub = stubProviders({ openrouter: openRouterText("ok") });
    // Same alphabet and shape as an issued key (prefix, hex, dashes), at a length that is not a real key's.
    await provider({ apiKey: `sk-or-v1-${"ab12".repeat(10)}` }).generate(request());
    expect(stub.openrouter).toHaveLength(1);
  });

  it("never follows a redirect, because the key travels in a header", async () => {
    stubProviders({ openrouter: openRouterText("ok") });
    await provider().generate(request());
    const init = (vi.mocked(fetch).mock.calls[0]![1] ?? {}) as RequestInit;
    expect(init.redirect).toBe("error");
  });
});
