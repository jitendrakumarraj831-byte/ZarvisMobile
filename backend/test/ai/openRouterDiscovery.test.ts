import { afterEach, describe, expect, it, vi } from "vitest";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import { createModelGateway } from "../../src/ai/providerFactory.js";
import { logger } from "../../src/security/redact.js";
import {
  OPENROUTER_KEY,
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
  type RecordedCall,
  type Responder,
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

/** The part of OpenRouter's model list the gateway reads. Context size decides the order of the suggestions. */
const model = (id: string, contextLength: number, parameters: string[] = ["tools"], input: string[] = ["text"]) => ({
  id,
  context_length: contextLength,
  architecture: { input_modalities: input },
  pricing: { prompt: "0", completion: "0" },
  supported_parameters: parameters,
});

const LIVE_LIST = {
  data: [
    model("vendor/large:free", 262_144),
    model("vendor/medium:free", 131_072),
    model("vendor/plain:free", 1_000_000, ["max_tokens"]),
    model("vendor/eyes:free", 65_536, ["tools"], ["text", "image"]),
    model("openrouter/free", 200_000),
  ],
};

const isList = (call: RecordedCall) => /\/models(\/user)?$/.test(call.url);
const chatCalls = (stub: { openrouter: RecordedCall[] }) => stub.openrouter.filter((call) => !isList(call));
const listCalls = (stub: { openrouter: RecordedCall[] }) => stub.openrouter.filter(isList);

/** OpenRouter as a test double: the model list, and a chat responder for everything else. */
function openRouter(chat: Responder, list: Responder = () => new Response(JSON.stringify(LIVE_LIST), { status: 200 })): Responder {
  return (call) => (isList(call) ? list(call) : chat(call));
}

function gatewayFor(overrides: Parameters<typeof fakeEnv>[0] = {}, options: { now?: () => number } = {}) {
  // Live discovery is what this file is about; the shared test environment switches it off.
  return createModelGateway(fakeEnv({ openRouterDiscovery: undefined, ...overrides }), { isProduction: true, now: options.now });
}

/** An environment like the production incident: a pinned free model that OpenRouter no longer offers. */
const pinnedGone = { openRouterModel: "inclusionai/ling-3.0-flash-sante:free", openRouterModelCapabilities: "tools" };

function captureLogs() {
  const lines: Array<{ level: string; message: string; data: Record<string, any> }> = [];
  for (const level of ["info", "warn", "error"] as const) {
    vi.spyOn(logger, level).mockImplementation((message: string, data?: Record<string, unknown>) => {
      lines.push({ level, message, data: (data ?? {}) as Record<string, any> });
    });
  }
  return lines;
}

describe("OpenRouter live model discovery inside the gateway", () => {
  it("is lazy: while Gemini answers, OpenRouter's model list is never fetched", async () => {
    const stub = stubProviders({ gemini: geminiText("fine"), openrouter: openRouter(openRouterText("unused")) });
    const response = await gatewayFor(pinnedGone).generate(chatRequest());

    expect(response.message.content).toBe("fine");
    expect(stub.openrouter).toHaveLength(0);
  });

  it("heals the production incident: Gemini's daily quota is spent and the pinned model is gone, yet the user gets an answer", async () => {
    const stub = stubProviders({
      gemini: geminiFail(429, JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota" } })),
      openrouter: openRouter(openRouterText("answered by a model OpenRouter really has", "vendor/large:free")),
    });
    const gateway = gatewayFor(pinnedGone);
    const response = await gateway.generate(chatRequest());

    expect(response.message.content).toBe("answered by a model OpenRouter really has");
    // One list request, then one chat request: no 404 was spent finding out the model was gone.
    expect(listCalls(stub)).toHaveLength(1);
    expect(chatCalls(stub)).toHaveLength(1);
    const body = chatCalls(stub)[0]!.body;
    expect(JSON.stringify(body)).not.toContain("ling-3.0");
    // The best match first, alternates after it, all in the one request (OpenRouter's own fallback).
    expect(body.models).toEqual(["vendor/plain:free", "vendor/large:free", "openrouter/free"]);
    expect(body.model).toBeUndefined();
    expect(response.meta).toMatchObject({ provider: "openrouter", fallback: true, configuredModel: "vendor/plain:free" });
  });

  it("asks only for models that can take the request: tools come only to models that list tools, with require_parameters", async () => {
    const stub = stubProviders({
      gemini: geminiFail(503, "down"),
      openrouter: openRouter(openRouterText("done")),
    });
    await gatewayFor(pinnedGone).generate(chatRequest({ tools: [searchTool] }));

    const body = chatCalls(stub)[0]!.body;
    expect(body.models).toEqual(["vendor/large:free", "vendor/medium:free", "openrouter/free"]);
    expect(body.provider).toMatchObject({ require_parameters: true });
    expect(body.tools).toHaveLength(1);
  });

  it("reads the list once for many requests, and sends the account's key only to OpenRouter", async () => {
    const stub = stubProviders({ gemini: geminiFail(503, "down"), openrouter: openRouter(openRouterText("ok")) });
    const gateway = gatewayFor(pinnedGone);
    for (let index = 0; index < 4; index += 1) await gateway.generate(chatRequest());

    expect(listCalls(stub)).toHaveLength(1);
    expect(listCalls(stub)[0]!.headers.authorization).toBe(`Bearer ${OPENROUTER_KEY}`);
    expect(chatCalls(stub)).toHaveLength(4);
  });

  it("does not choose a model again after OpenRouter answered 404 for it", async () => {
    let attempt = 0;
    const stub = stubProviders({
      gemini: geminiFail(503, "down"),
      openrouter: openRouter((call) => {
        attempt += 1;
        return attempt === 1 ? openRouterFail(404, "No endpoints found for vendor/plain:free.")(call) : openRouterText("second request works")(call);
      }),
    });
    const gateway = gatewayFor(pinnedGone);
    const first = await gateway.generate(chatRequest()).then(() => undefined, (e: unknown) => e as AIProviderError);
    expect(first).toBeInstanceOf(AIProviderError);
    // A 404 is a configuration problem, not an outage: it is recorded as such, and Gemini's own outage is what the caller is told.
    expect(first!.attempts).toContainEqual({ provider: "openrouter", model: "vendor/plain:free", kind: "AI_PROVIDER_CAPABILITY_UNSUPPORTED", status: 404 });

    const second = await gateway.generate(chatRequest());
    expect(second.message.content).toBe("second request works");
    // The 404 named three models in the first request; none of them is in the second.
    expect(chatCalls(stub)[1]!.body.models ?? [chatCalls(stub)[1]!.body.model]).not.toContain("vendor/plain:free");
  });

  it("still works when the model list cannot be read: the declared model is used, and the list is not asked again at once", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    let now = 1_000_000;
    const stub = stubProviders({
      gemini: geminiFail(503, "down"),
      openrouter: openRouter(openRouterText("declared model answered", "inclusionai/ling-3.0-flash-sante:free"), () => new Response("down", { status: 503 })),
    });
    const gateway = gatewayFor(pinnedGone, { now: () => now });
    const first = await gateway.generate(chatRequest());
    now += 5_000;
    await gateway.generate(chatRequest());

    expect(first.message.content).toBe("declared model answered");
    expect(chatCalls(stub).map((call) => call.body.model)).toEqual(["inclusionai/ling-3.0-flash-sante:free", "inclusionai/ling-3.0-flash-sante:free"]);
    // 503 on /models/user then the public list: one attempt of each, not one per request.
    expect(listCalls(stub)).toHaveLength(2);
  });

  it("with discovery off nothing is fetched and the request is exactly the declared model, as before", async () => {
    const stub = stubProviders({ gemini: geminiFail(503, "down"), openrouter: openRouter(openRouterText("ok")) });
    await gatewayFor({ ...pinnedGone, openRouterDiscovery: "off" }).generate(chatRequest());

    expect(listCalls(stub)).toHaveLength(0);
    expect(chatCalls(stub)[0]!.body.model).toBe("inclusionai/ling-3.0-flash-sante:free");
    expect(chatCalls(stub)[0]!.body.models).toBeUndefined();
  });

  it("works when OpenRouter is the primary provider too: the list is read before the first request", async () => {
    const stub = stubProviders({ openrouter: openRouter(openRouterText("primary answer")) });
    const response = await gatewayFor({ ...pinnedGone, geminiApiKey: undefined, aiPrimaryProvider: "openrouter" }).generate(chatRequest());

    expect(response.message.content).toBe("primary answer");
    expect(listCalls(stub)).toHaveLength(1);
    expect(JSON.stringify(chatCalls(stub)[0]!.body)).not.toContain("ling-3.0");
  });

  it("picks a vision model from the list's input modalities, with no operator declaration", async () => {
    const stub = stubProviders({ gemini: geminiFail(503, "down"), openrouter: openRouter(openRouterText("a cat")) });
    const gateway = gatewayFor(pinnedGone);
    const result = await gateway.analyzeImage({ data: Buffer.from("png"), mimeType: "image/png" }).catch((e: unknown) => e);

    expect(result).not.toBeInstanceOf(Error);
    expect(gateway.canAnalyzeImage("image/png")).toBe(true);
    const body = chatCalls(stub)[0]!.body;
    expect(body.models?.[0] ?? body.model).toBe("vendor/eyes:free");
    expect(result).not.toBeInstanceOf(Error);
  });

  it("chooses paid models only when allowed, and holds them to the operator's price limit", async () => {
    const list = {
      data: [
        { ...model("vendor/free:free", 8_000), pricing: { prompt: "0", completion: "0" } },
        { ...model("vendor/cheap", 500_000), pricing: { prompt: "0.0000005", completion: "0.0000015" } },
        { ...model("vendor/dear", 900_000), pricing: { prompt: "0.00005", completion: "0.0001" } },
      ],
    };
    const run = async (overrides: Parameters<typeof fakeEnv>[0]) => {
      const stub = stubProviders({ gemini: geminiFail(503, "down"), openrouter: openRouter(openRouterText("ok"), () => new Response(JSON.stringify(list), { status: 200 })) });
      await gatewayFor({ ...pinnedGone, ...overrides }).generate(chatRequest());
      const body = chatCalls(stub)[0]!.body;
      vi.unstubAllGlobals();
      return body;
    };

    expect((await run({})).models ?? [(await run({})).model]).toEqual(["vendor/free:free"]);
    const allowed = await run({ openRouterAllowPaid: "true", openRouterMaxPricePrompt: "1", openRouterMaxPriceCompletion: "3" });
    expect(allowed.models).toEqual(["vendor/cheap", "vendor/free:free"]);
    // The limit also goes to OpenRouter, so a model it routes to cannot cost more than the operator allowed.
    expect(allowed.provider.max_price).toEqual({ prompt: 1, completion: 3 });
  });

  it("names the operator's own alternates ahead of the suggestions", async () => {
    const stub = stubProviders({ gemini: geminiFail(503, "down"), openrouter: openRouter(openRouterText("ok")) });
    await gatewayFor({ ...pinnedGone, openRouterFallbackModels: "vendor/eyes:free" }).generate(chatRequest({ tools: [searchTool] }));

    expect(chatCalls(stub)[0]!.body.models).toEqual(["vendor/eyes:free", "vendor/large:free", "openrouter/free"]);
  });

  it("reports the model list in the provider status, without naming a key", async () => {
    stubProviders({ gemini: geminiFail(503, "down"), openrouter: openRouter(openRouterText("ok")) });
    const gateway = gatewayFor(pinnedGone);
    await gateway.generate(chatRequest());

    const openrouterStatus = gateway.getProviderStatus().providers.find((provider) => provider.id === "openrouter")!;
    expect(openrouterStatus.liveModels).toMatchObject({ loaded: true, fresh: true, models: 5, source: "account" });
    expect(JSON.stringify(gateway.getProviderStatus())).not.toContain(OPENROUTER_KEY);
  });
});

describe("a data-policy refusal names its cause in the log", () => {
  it("the 'AI call failed' line carries OpenRouter's own reason (the account setting to change), without the key", async () => {
    const lines = captureLogs();
    const zdr =
      "0 endpoints out of 8 requested are available matching your guardrail restrictions and data policy. We removed them for the following reasons (an endpoint may have matched multiple reasons): ZDR violation (account settings): 8 endpoints excluded; configurable at https://openrouter.ai/settings/privacy";
    stubProviders({ gemini: geminiFail(503, "down"), openrouter: openRouter(openRouterFail(404, zdr)) });
    await gatewayFor(pinnedGone).generate(chatRequest()).catch(() => undefined);

    const failed = lines.find((line) => line.message === "AI call failed")!;
    expect(failed.data.failedAttempts).toContainEqual(expect.objectContaining({ provider: "openrouter", status: 404, kind: "AI_PROVIDER_CAPABILITY_UNSUPPORTED" }));
    expect(JSON.stringify(failed.data)).not.toContain(OPENROUTER_KEY);
  });

  it("when OpenRouter is the last provider asked, its reason is the one logged", async () => {
    const lines = captureLogs();
    stubProviders({ openrouter: openRouter(openRouterFail(404, "0 endpoints out of 1 requested are available ... ZDR violation (account settings): 1 endpoint excluded")) });
    await gatewayFor({ ...pinnedGone, geminiApiKey: undefined, aiPrimaryProvider: "openrouter" }).generate(chatRequest()).catch(() => undefined);

    const failed = lines.find((line) => line.message === "AI call failed")!;
    expect(String(failed.data.errorDetail)).toContain("ZDR violation (account settings)");
  });
});

describe("a rejected OpenRouter key is visible instead of silent", () => {
  it("the account list answers 401 and the chat answers 401: /health says OpenRouter's key is rejected, and a later success clears it", async () => {
    let healthy = false;
    stubProviders({
      gemini: geminiFail(503, "down"),
      openrouter: openRouter(
        (call) => (healthy ? openRouterText("back")(call) : openRouterFail(401, "User not found.")(call)),
        (call) => (healthy || !call.url.endsWith("/models/user") ? new Response(JSON.stringify(LIVE_LIST), { status: 200 }) : new Response("{}", { status: 401 })),
      ),
    });
    const gateway = gatewayFor(pinnedGone);
    expect(gateway.healthSummary()).toEqual({ provider: "google", fallback: true, fallbackTools: true });

    const failed = await gateway.generate(chatRequest()).then(() => undefined, (e: unknown) => e as AIProviderError);
    expect(failed).toBeInstanceOf(AIProviderError);
    expect(gateway.healthSummary()).toMatchObject({ authRejected: ["openrouter"] });

    healthy = true;
    // The directory is stale only after its TTL; a success from the provider clears the failure note.
    await gateway.generate(chatRequest());
    expect(gateway.getProviderStatus().providers.find((p) => p.id === "openrouter")!.authRejected).toBeUndefined();
  });

  it("a key with a line break in it is refused before any request leaves, and never appears in the error", async () => {
    const stub = stubProviders({ gemini: geminiFail(503, "down"), openrouter: openRouter(openRouterText("never")) });
    const brokenKey = "sk-or-v1-abcdefgh\nijkl";
    const gateway = gatewayFor({ ...pinnedGone, openRouterApiKey: brokenKey });
    const failure = await gateway.generate(chatRequest()).then(() => undefined, (e: unknown) => e as AIProviderError);

    expect(chatCalls(stub)).toHaveLength(0);
    expect(failure).toBeInstanceOf(AIProviderError);
    expect(JSON.stringify(failure)).not.toContain("abcdefgh");
    expect(failure!.message).not.toContain("ijkl");
  });
});

describe("cost and usage are logged per call", () => {
  it("writes the tokens used and the cost OpenRouter reports, and the log keeps both visible", async () => {
    const lines = captureLogs();
    stubProviders({
      gemini: geminiFail(503, "down"),
      openrouter: openRouter(
        () =>
          new Response(
            JSON.stringify({
              id: "gen-1",
              model: "vendor/large:free",
              choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.00042 },
            }),
            { status: 200 },
          ),
      ),
    });
    await gatewayFor(pinnedGone).generate(chatRequest());

    const call = lines.find((line) => line.message === "AI call")!;
    expect(call.data.usage).toEqual({ prompt: 120, completion: 30 });
    expect(call.data.costUsd).toBeCloseTo(0.00042);
    expect(JSON.stringify(call.data)).not.toContain("[REDACTED]");
  });
});

describe("structured outputs through the gateway", () => {
  const schema = { type: "object", properties: { city: { type: "string" } }, required: ["city"], additionalProperties: false };
  const schemaRequest = () => chatRequest({ responseFormat: { type: "json_schema", name: "place", schema } });
  const withSchemaModel = { data: [model("vendor/schema:free", 100_000, ["tools", "structured_outputs"]), model("vendor/loose:free", 900_000, ["tools"])] };

  it("JSON mode on Gemini sets responseMimeType", async () => {
    const stub = stubProviders({ gemini: geminiText('{"a":1}') });
    await gatewayFor().generate(chatRequest({ responseFormat: "json" }));
    expect(stub.gemini[0]!.body.generationConfig.responseMimeType).toBe("application/json");
    expect(stub.openrouter).toHaveLength(0);
  });

  it("a request without a response format leaves Gemini's configuration untouched", async () => {
    const stub = stubProviders({ gemini: geminiText("hi") });
    await gatewayFor().generate(chatRequest());
    expect(stub.gemini[0]!.body.generationConfig).not.toHaveProperty("responseMimeType");
  });

  it("a JSON Schema goes only to a model that enforces one: Gemini is skipped, and OpenRouter gets a model its list says supports it", async () => {
    const stub = stubProviders({ gemini: geminiText("must not be asked"), openrouter: openRouter(openRouterText('{"city":"Pune"}'), () => new Response(JSON.stringify(withSchemaModel), { status: 200 })) });
    const response = await gatewayFor(pinnedGone).generate(schemaRequest());

    expect(response.message.content).toBe('{"city":"Pune"}');
    expect(stub.gemini).toHaveLength(0);
    const body = chatCalls(stub)[0]!.body;
    expect(body.model).toBe("vendor/schema:free");
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "place", strict: true, schema } });
    expect(body.provider).toEqual({ require_parameters: true });
  });

  it("with no model that can enforce the schema, the request fails clearly and nothing is sent to a provider", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const loose = { data: [model("vendor/loose:free", 900_000, ["tools"])] };
    const stub = stubProviders({ gemini: geminiText("must not be asked"), openrouter: openRouter(openRouterText("no"), () => new Response(JSON.stringify(loose), { status: 200 })) });
    const failed = await gatewayFor(pinnedGone).generate(schemaRequest()).then(() => undefined, (e: unknown) => e as AIProviderError);

    expect(failed).toBeInstanceOf(AIProviderError);
    expect(failed!.kind).toBe("AI_PROVIDER_CAPABILITY_UNSUPPORTED");
    expect(stub.gemini).toHaveLength(0);
    expect(chatCalls(stub)).toHaveLength(0);
  });
});

describe("streaming through the gateway with live model data", () => {
  it("falls back to OpenRouter before any text was sent, with the models the list offers, and streams that answer", async () => {
    const stub = stubProviders({
      gemini: geminiFail(503, "down"),
      openrouter: openRouter(() => sseResponse([": OPENROUTER PROCESSING\n\n", openRouterSse("Hello "), openRouterSse("there", "vendor/large:free"), "data: [DONE]\n\n"])),
    });
    const text: string[] = [];
    let meta;
    for await (const chunk of gatewayFor(pinnedGone).streamText({ ...chatRequest() })) {
      text.push(chunk.delta);
      if (chunk.done) meta = chunk.meta;
    }

    expect(text.join("")).toBe("Hello there");
    expect(chatCalls(stub)).toHaveLength(1);
    expect(chatCalls(stub)[0]!.body.stream).toBe(true);
    expect(chatCalls(stub)[0]!.body.models).toEqual(["vendor/plain:free", "vendor/large:free", "openrouter/free"]);
    expect(meta).toMatchObject({ provider: "openrouter", fallback: true });
  });

  it("never switches providers once text was delivered", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const stub = stubProviders({
      gemini: () => sseResponse([geminiSse("partial ")], { failAfter: new TypeError("terminated") }),
      openrouter: openRouter(openRouterText("must not be used")),
    });
    const text: string[] = [];
    const failed = await (async () => {
      try {
        for await (const chunk of gatewayFor(pinnedGone).streamText(chatRequest())) text.push(chunk.delta);
      } catch (e) {
        return e as AIProviderError;
      }
      return undefined;
    })();

    expect(text.join("")).toBe("partial ");
    expect(failed).toBeDefined();
    expect(stub.openrouter).toHaveLength(0);
  });

  it("learns a tool-capable fallback from the list when Gemini fails after the declared catalog named none", async () => {
    // The declared OpenRouter model has no tool support (the default), yet the list proves some models do.
    const stub = stubProviders({ gemini: geminiFail(503, "down"), openrouter: openRouter(openRouterText("used a tool-capable model")) });
    const response = await gatewayFor({ openRouterModel: "inclusionai/ling-3.0-flash-sante:free" }).generate(chatRequest({ tools: [searchTool] }));

    expect(response.message.content).toBe("used a tool-capable model");
    expect(listCalls(stub)).toHaveLength(1);
    expect(chatCalls(stub)[0]!.body.models).toEqual(["vendor/large:free", "vendor/medium:free", "openrouter/free"]);
  });

  it("does not fetch the list for that when Gemini answers", async () => {
    const stub = stubProviders({ gemini: geminiText("fine"), openrouter: openRouter(openRouterText("unused")) });
    await gatewayFor({ openRouterModel: "inclusionai/ling-3.0-flash-sante:free" }).generate(chatRequest({ tools: [searchTool] }));
    expect(stub.openrouter).toHaveLength(0);
  });
});
