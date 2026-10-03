import { afterEach, describe, expect, it, vi } from "vitest";
import { Orchestrator, TurnInProgressError } from "../../src/agents/orchestrator.js";
import { createContentGenerator } from "../../src/ai/contentGenerator.js";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import { createModelGateway } from "../../src/ai/providerFactory.js";
import { ServerConfirmationService } from "../../src/security/confirmationService.js";
import { logger } from "../../src/security/redact.js";
import { CREATIVE_WRITE_POEM_SYSTEM_PROMPT, createCreativeWritePoemSkill } from "../../src/skills/creativeWritePoem.js";
import { createWebSearchSkill, GeminiSearchProvider } from "../../src/skills/webSearch.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { PostgresStore } from "../../src/store/postgresStore.js";
import type { Store } from "../../src/store/store.js";
import type { EntitlementPort } from "../../src/tooling/ports.js";
import { SkillRegistry } from "../../src/tooling/skillRegistry.js";
import { ToolPipeline } from "../../src/tooling/toolPipeline.js";
import { DAILY, quotaBody } from "../ai/geminiFixtures.js";
import { GEMINI_KEY, fakeEnv, geminiCall, geminiFail, geminiText, openRouterCall, openRouterFail, openRouterText, stubProviders, type Responder } from "../ai/gatewayHarness.js";

// Retry waits are covered in geminiErrors.test.ts; here they would only slow the tests.
vi.mock("../../src/ai/geminiErrors.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/ai/geminiErrors.js")>()),
  sleep: async () => {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const STORES: Array<[string, () => Store]> = [
  ["in-memory store", () => new InMemoryStore()],
  ...(TEST_DATABASE_URL ? ([["postgres store", () => new PostgresStore(TEST_DATABASE_URL)]] as Array<[string, () => Store]>) : []),
];

/** Gemini answers by what the request is: a planner step (function declarations), grounded search, or plain generation. */
function gemini(script: { planner?: Responder[]; generation?: Responder; search?: Responder } = {}): Responder {
  const planner = [...(script.planner ?? [])];
  return (call) => {
    const tool = call.body?.tools?.[0];
    if (tool?.googleSearch) return (script.search ?? geminiSearchAnswer())(call);
    if (tool?.functionDeclarations) return (planner.shift() ?? geminiText("Done."))(call);
    return (script.generation ?? geminiText("Baadal garje, boondein naachein..."))(call);
  };
}

const geminiSearchAnswer = (): Responder => () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Sunny, 31 degrees." }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.org/weather", title: "Weather" } }] } }] }), { status: 200 });

/** What the fallback model writes: neutral text, so a leak check can only match real metadata. */
const FALLBACK_POEM = "Clouds gather over the river.";

/** OpenRouter answers a planner step (tools present) or plain generation. */
function openRouter(script: { planner?: Responder[]; generation?: Responder } = {}): Responder {
  const planner = [...(script.planner ?? [])];
  return (call) => (call.body?.tools ? (planner.shift() ?? openRouterText("Done."))(call) : (script.generation ?? openRouterText(FALLBACK_POEM))(call));
}

async function setup(store: Store, envOverrides: Parameters<typeof fakeEnv>[0] = {}) {
  const gateway = createModelGateway(fakeEnv(envOverrides), { isProduction: true });
  const registry = new SkillRegistry();
  registry.register(createWebSearchSkill(new GeminiSearchProvider(GEMINI_KEY, "gemini-3.6-flash")));
  registry.register(createCreativeWritePoemSkill(createContentGenerator(gateway, "poem", CREATIVE_WRITE_POEM_SYSTEM_PROMPT, { isProduction: true })));
  const entitlement: EntitlementPort = { snapshot: async () => ({ accountId: "a", plan: "PRO", trialExpiresAt: null, creditBalance: 100 }) };
  const charge = vi.fn(async () => 0);
  const pipeline = new ToolPipeline(registry, { isGranted: async () => true }, entitlement, { charge }, new ServerConfirmationService(store));
  const orchestrator = new Orchestrator(registry, entitlement, pipeline, gateway, gateway.defaultModelConfig(), store);
  const user = await store.createUser(`gateway-${crypto.randomUUID()}@test.dev`, "x");
  const account = await store.createAccountForUser(user.id);
  return { orchestrator, gateway, charge, store, accountId: account.id };
}

function turnLog() {
  const info = vi.spyOn(logger, "info");
  return () => info.mock.calls.find(([message]) => message === "Turn finished")?.[1] as Record<string, any> | undefined;
}

describe("a user turn through the gateway: request economy and billing", () => {
  it("a greeting or an identity question sends no model request at all", async () => {
    const stub = stubProviders({ gemini: gemini(), openrouter: openRouter() });
    const { orchestrator, accountId } = await setup(new InMemoryStore());
    await orchestrator.runTurn({ accountId, utterance: "Hi" });
    await orchestrator.runTurn({ accountId, utterance: "aapko kisne banaya?" });
    expect(stub.calls).toHaveLength(0);
  });

  it("a poem on a healthy Gemini: three requests (plan, poem, final reply), all Gemini, one charge", async () => {
    const stub = stubProviders({ gemini: gemini({ planner: [geminiCall("creative.write_poem", { prompt: "monsoon" }), geminiText("Yeh rahi aapki kavita.")] }), openrouter: openRouter() });
    const { orchestrator, accountId, charge } = await setup(new InMemoryStore());
    const read = turnLog();

    const result = await orchestrator.runTurn({ accountId, utterance: "monsoon par poem likho" });

    expect(result.message).toBe("Yeh rahi aapki kavita.");
    expect(stub.gemini).toHaveLength(3);
    expect(stub.openrouter).toHaveLength(0);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledWith(accountId, { value: 1, unit: "credits" }, "creative.write_poem");
    expect(read()).toMatchObject({ aiCalls: 3, aiLogicalCalls: 3, aiFallbackCalls: 0, aiProviders: ["google"], chargedCredits: 1 });
  });

  it("when Gemini's quota is spent for the poem, ONE OpenRouter request answers it: one charge, and the turn log shows the switch", async () => {
    const stub = stubProviders({
      gemini: gemini({ planner: [geminiCall("creative.write_poem", { prompt: "monsoon" }), geminiText("Here is your poem.")], generation: geminiFail(429, quotaBody(DAILY)) }),
      openrouter: openRouter(),
    });
    const { orchestrator, accountId, charge } = await setup(new InMemoryStore());
    const read = turnLog();

    const result = await orchestrator.runTurn({ accountId, utterance: "monsoon par poem likho" });

    expect(result.toolCalls[0]?.outcome).toMatchObject({ kind: "success", result: { summary: FALLBACK_POEM } });
    expect(stub.gemini).toHaveLength(3); // plan, the refused poem request, final reply
    expect(stub.openrouter).toHaveLength(1);
    expect(charge).toHaveBeenCalledTimes(1); // the fallback is inside ONE skill execution: one charge
    const log = read()!;
    expect(log).toMatchObject({ aiLogicalCalls: 3, aiFallbackCalls: 1, aiProviders: ["google", "openrouter"], chargedCredits: 1 });
    expect(log.aiCallLog.filter((call: any) => call.kind === "generation").map((call: any) => [call.provider, call.outcome, call.fallback ?? false])).toEqual([
      ["google", "error", false],
      ["openrouter", "ok", true],
    ]);
  });

  it("nothing reaches the client that names the fallback: the result and its tool calls carry no provider detail", async () => {
    stubProviders({ gemini: gemini({ planner: [geminiCall("creative.write_poem", { prompt: "x" }), geminiText("ok")], generation: geminiFail(429, quotaBody(DAILY)) }), openrouter: openRouter() });
    const { orchestrator, accountId } = await setup(new InMemoryStore());

    const result = await orchestrator.runTurn({ accountId, utterance: "poem likho" });

    // Structural check on what is sent to a client: no provider, model, fallback or meta field anywhere.
    const wire = JSON.stringify(result);
    expect(wire).toContain(FALLBACK_POEM); // the fallback really answered
    expect(wire).not.toMatch(/"(provider|providers|meta|model|servedModel|configuredModel|fallback\w*|attempts)"\s*:/);
    expect(wire).not.toMatch(/openrouter|GEMINI_QUOTA|vendor\/|gen-or-/i);
  });

  it("when both providers fail for the skill and the quota is spent on both, the turn ends honestly: not charged, no further model call", async () => {
    const stub = stubProviders({
      gemini: gemini({ planner: [geminiCall("creative.write_poem", { prompt: "monsoon" }), geminiText("never asked")], generation: geminiFail(429, quotaBody(DAILY)) }),
      openrouter: openRouter({ generation: openRouterFail(429, "Rate limit exceeded: free-models-per-day.") }),
    });
    const { orchestrator, accountId, charge } = await setup(new InMemoryStore());

    const result = await orchestrator.runTurn({ accountId, utterance: "monsoon par poem likho" });

    expect(result.toolCalls[0]?.outcome).toMatchObject({ kind: "execution_failed", result: { reason: "ai_quota_exceeded" } });
    expect(result.message).toMatch(/usage limit/);
    expect(charge).not.toHaveBeenCalled(); // a failed generation is never charged
    expect(stub.gemini).toHaveLength(2); // the planner, and the refused poem request; no re-plan after a spent quota
    expect(stub.openrouter).toHaveLength(1);
  });

  it("when the fallback is merely unavailable the failure is a retryable outage, still not charged", async () => {
    stubProviders({
      gemini: gemini({ planner: [geminiCall("creative.write_poem", { prompt: "monsoon" }), geminiText("Sorry, the poem service is down. Please try again.")], generation: geminiFail(429, quotaBody(DAILY)) }),
      openrouter: openRouter({ generation: openRouterFail(503, "overloaded") }),
    });
    const { orchestrator, accountId, charge } = await setup(new InMemoryStore());

    const result = await orchestrator.runTurn({ accountId, utterance: "monsoon par poem likho" });

    expect(result.toolCalls[0]?.outcome).toMatchObject({ kind: "execution_failed", result: { reason: "ai_provider_unavailable", userMessage: expect.stringMatching(/temporarily unavailable/) } });
    expect(charge).not.toHaveBeenCalled();
    expect(result.message).toContain("Sorry");
  });

  it("the planner falls back when OpenRouter declares tools, while web search stays on Gemini (it is never routed through OpenRouter)", async () => {
    const stub = stubProviders({
      gemini: gemini({ planner: [geminiFail(429, quotaBody(DAILY))] }),
      openrouter: openRouter({ planner: [openRouterCall("web-search", { query: "Forbesganj weather" }), openRouterText("Kal dhoop rahegi.")] }),
    });
    const { orchestrator, accountId, charge } = await setup(new InMemoryStore(), { openRouterModelCapabilities: "tools" });

    const result = await orchestrator.runTurn({ accountId, utterance: "kal Forbesganj ka weather kaisa rahega?" });

    expect(result.message).toBe("Kal dhoop rahegi.");
    expect(result.toolCalls.map((call) => [call.skillId, call.outcome.kind])).toEqual([["web.search", "success"]]);
    // The search itself is a Gemini request with Google Search grounding; OpenRouter never sees one.
    const searches = stub.gemini.filter((call) => call.body?.tools?.[0]?.googleSearch);
    expect(searches).toHaveLength(1);
    expect(stub.openrouter.some((call) => JSON.stringify(call.body).includes("googleSearch"))).toBe(false);
    // Plan: 1 Gemini planner request (refused), then the quota cooldown sends the next planner step straight to OpenRouter.
    expect(stub.gemini.filter((call) => call.body?.tools?.[0]?.functionDeclarations)).toHaveLength(1);
    expect(stub.openrouter).toHaveLength(2);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledWith(accountId, { value: 2, unit: "credits" }, "web.search");
  });

  it("without declared tool support the planner does NOT fall back: the user gets the honest quota error, and OpenRouter is never asked to 'use' a tool", async () => {
    const stub = stubProviders({ gemini: gemini({ planner: [geminiFail(429, quotaBody(DAILY))] }), openrouter: openRouter() });
    const { orchestrator, accountId, charge } = await setup(new InMemoryStore());

    const failure = await orchestrator.runTurn({ accountId, utterance: "kal ka weather kaisa rahega?" }).catch((error) => error);

    expect(failure).toBeInstanceOf(AIProviderError);
    expect(failure).toMatchObject({ code: "AI_QUOTA_EXCEEDED" });
    expect(stub.openrouter).toHaveLength(0);
    expect(charge).not.toHaveBeenCalled();
  });

  it("a model that cannot call tools never gets a tool pretended: OpenRouter-only without tool support fails with a capability error and sends nothing", async () => {
    const stub = stubProviders({ openrouter: openRouter() });
    const { orchestrator, accountId } = await setup(new InMemoryStore(), { geminiApiKey: undefined });

    const failure = await orchestrator.runTurn({ accountId, utterance: "kal ka weather kaisa rahega?" }).catch((error) => error);

    expect(failure).toMatchObject({ kind: "AI_PROVIDER_CAPABILITY_UNSUPPORTED", code: "AI_UNAVAILABLE" });
    expect(stub.calls).toHaveLength(0);
  });
});

describe("a client that goes away", () => {
  it("while the primary provider is struggling: no fallback request, no tool, no charge, an honest 'cancelled' outcome", async () => {
    const controller = new AbortController();
    const stub = stubProviders({
      gemini: (call) => {
        controller.abort(); // the user pressed Stop while Gemini was failing
        return geminiFail(503)(call);
      },
      openrouter: openRouter(),
    });
    const { orchestrator, accountId, charge } = await setup(new InMemoryStore(), { openRouterModelCapabilities: "tools" });
    const read = turnLog();

    const failure = await orchestrator.runTurn({ accountId, utterance: "monsoon par poem likho", signal: controller.signal }).catch((error) => error);

    expect(failure.name).toBe("AbortError");
    expect(stub.gemini).toHaveLength(1); // not even Gemini's own retries continue
    expect(stub.openrouter).toHaveLength(0);
    expect(charge).not.toHaveBeenCalled();
    expect(read()).toMatchObject({ outcome: "cancelled", aiCalls: 1, toolCalls: [] });
  });
});

describe.each(STORES)("duplicate protection through the gateway (%s)", (_label, makeStore) => {
  const poemScript = () => gemini({ planner: [geminiCall("creative.write_poem", { prompt: "monsoon" }), geminiText("Yeh rahi aapki kavita.")] });

  it("a completed turn re-sent with the same clientTurnId causes NO new model request and NO second charge", async () => {
    const stub = stubProviders({ gemini: poemScript(), openrouter: openRouter() });
    const { orchestrator, accountId, charge } = await setup(makeStore());
    const clientTurnId = crypto.randomUUID();

    const first = await orchestrator.runTurn({ accountId, utterance: "monsoon par poem likho", clientTurnId });
    const requestsAfterFirst = stub.calls.length;
    const again = await orchestrator.runTurn({ accountId, utterance: "monsoon par poem likho", clientTurnId });

    expect(requestsAfterFirst).toBe(3);
    expect(stub.calls).toHaveLength(requestsAfterFirst);
    expect(again).toMatchObject({ replayed: true, message: first.message });
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it("two simultaneous submissions of one turn run it once: the second is refused while the first is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: Responder = async (call) => {
      await gate;
      return geminiText("slow but single")(call);
    };
    const stub = stubProviders({ gemini: (call) => (call.body?.tools?.[0]?.functionDeclarations ? slow(call) : geminiText("x")(call)), openrouter: openRouter() });
    const { orchestrator, accountId } = await setup(makeStore());
    const clientTurnId = crypto.randomUUID();

    const first = orchestrator.runTurn({ accountId, utterance: "explain rivers", clientTurnId });
    await vi.waitFor(() => expect(stub.gemini).toHaveLength(1));
    await expect(orchestrator.runTurn({ accountId, utterance: "explain rivers", clientTurnId })).rejects.toBeInstanceOf(TurnInProgressError);
    release();

    expect((await first).message).toBe("slow but single");
    expect(stub.calls).toHaveLength(1); // one user turn, one model request
  });

  it("a Retry after BOTH providers failed runs the turn again once, charges once, and stores the user's message once", async () => {
    let failing = true;
    const stub = stubProviders({
      gemini: (call) => (failing ? geminiFail(503)(call) : geminiText("Here you go.")(call)),
      openrouter: openRouterFail(503, "overloaded"),
    });
    const { orchestrator, accountId, charge, store } = await setup(makeStore(), { openRouterModelCapabilities: "tools" });
    const clientTurnId = crypto.randomUUID();

    await expect(orchestrator.runTurn({ accountId, utterance: "kal ka weather?", clientTurnId })).rejects.toBeInstanceOf(AIProviderError);
    const firstAttemptRequests = stub.calls.length;
    failing = false;
    const retry = await orchestrator.runTurn({ accountId, utterance: "kal ka weather?", clientTurnId });

    expect(firstAttemptRequests).toBe(6 + 3); // Gemini's bounded retries on two models, then OpenRouter's bounded retries; nothing more
    expect(stub.calls.length - firstAttemptRequests).toBe(1); // the retry is one request
    expect(retry.message).toBe("Here you go.");
    expect(charge).not.toHaveBeenCalled();
    const messages = await store.listConversationMessages(accountId, retry.conversationId, 40);
    expect(messages.map((message) => `${message.role}:${message.content}`)).toEqual(["user:kal ka weather?", "assistant:Here you go."]);
  });

  it("a Retry after a failure LATE in the turn reuses the tool result: one execution, one charge, even across providers", async () => {
    let finalStepFails = true;
    const searchCalls = vi.fn();
    const stub = stubProviders({
      gemini: (call) => {
        const tool = call.body?.tools?.[0];
        if (tool?.googleSearch) {
          searchCalls();
          return geminiSearchAnswer()(call);
        }
        // planner: step 1 asks for a search, step 2 (after the result) fails while finalStepFails.
        const hasResult = JSON.stringify(call.body.contents).includes("[Tool result]");
        if (!hasResult) return geminiCall("web.search", { query: "weather" })(call);
        return finalStepFails ? geminiFail(503)(call) : geminiText("Sunny tomorrow.")(call);
      },
      openrouter: openRouterFail(503, "overloaded"),
    });
    const { orchestrator, accountId, charge } = await setup(makeStore(), { openRouterModelCapabilities: "tools" });
    const clientTurnId = crypto.randomUUID();

    await expect(orchestrator.runTurn({ accountId, utterance: "kal ka weather?", clientTurnId })).rejects.toBeInstanceOf(AIProviderError);
    expect(searchCalls).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledTimes(1);

    finalStepFails = false;
    const retry = await orchestrator.runTurn({ accountId, utterance: "kal ka weather?", clientTurnId });

    expect(retry.message).toBe("Sunny tomorrow.");
    expect(searchCalls).toHaveBeenCalledTimes(1); // not searched again
    expect(charge).toHaveBeenCalledTimes(1); // not charged again
    expect(stub.openrouter.length).toBeGreaterThan(0); // the failed attempt did try the fallback, once
  });
});
