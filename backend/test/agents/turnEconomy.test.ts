import { afterEach, describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../../src/agents/orchestrator.js";
import { AIContentGenerator } from "../../src/ai/contentGenerator.js";
import { GeminiProvider } from "../../src/ai/geminiProvider.js";
import { ServerConfirmationService } from "../../src/security/confirmationService.js";
import { createCreativeWritePoemSkill, CREATIVE_WRITE_POEM_SYSTEM_PROMPT } from "../../src/skills/creativeWritePoem.js";
import { createWebSearchSkill, GeminiSearchProvider } from "../../src/skills/webSearch.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import type { EntitlementPort } from "../../src/tooling/ports.js";
import { SkillRegistry } from "../../src/tooling/skillRegistry.js";
import { ToolPipeline } from "../../src/tooling/toolPipeline.js";
import { DAILY, quotaBody } from "../ai/geminiFixtures.js";

/**
 * Request economy: how many real Gemini HTTP requests one user turn sends, for each kind of
 * turn, with the production provider, web search provider and content generator wired as in
 * skills/index.ts. Only `fetch` is stubbed. These numbers are the documented budget
 * (DEEP_AUDIT_2026-10-02.md §6); a change that adds a call to a turn type fails here.
 */
type Kind = "planner" | "search" | "generation";

interface Scenario {
  /** Planner (orchestrator) responses, in order: a function call or final text. */
  planner: Array<{ call: string; args: Record<string, unknown> } | { text: string } | { status: number; body: string }>;
  search?: { status: number; body: string };
}

function gemini(parts: unknown[]): Response {
  return new Response(JSON.stringify({ responseId: "r", candidates: [{ content: { parts }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.org", title: "Example" } }] } }] }), { status: 200 });
}

function stubGemini(scenario: Scenario) {
  const calls: Kind[] = [];
  const planner = [...scenario.planner];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.tools?.[0]?.googleSearch) {
      calls.push("search");
      return scenario.search ? new Response(scenario.search.body, { status: scenario.search.status }) : gemini([{ text: "Sunny, 31°C." }]);
    }
    if (body.tools?.[0]?.functionDeclarations) {
      calls.push("planner");
      const next = planner.shift() ?? { text: "done" };
      if ("status" in next) return new Response(next.body, { status: next.status });
      return "call" in next ? gemini([{ functionCall: { name: next.call, args: next.args } }]) : gemini([{ text: next.text }]);
    }
    calls.push("generation");
    return gemini([{ text: "Baadal garje, boondein naachein..." }]);
  }));
  return calls;
}

async function setup() {
  const store = new InMemoryStore();
  const provider = new GeminiProvider("k");
  const model = { provider: "google", model: "gemini-3.6-flash" };
  const registry = new SkillRegistry();
  registry.register(createWebSearchSkill(new GeminiSearchProvider("k", "gemini-3.6-flash")));
  registry.register(createCreativeWritePoemSkill(new AIContentGenerator(provider, model, CREATIVE_WRITE_POEM_SYSTEM_PROMPT)));
  const entitlement: EntitlementPort = { snapshot: async () => ({ accountId: "a", plan: "PRO", trialExpiresAt: null, creditBalance: 100 }) };
  const pipeline = new ToolPipeline(registry, { isGranted: async () => true }, entitlement, { charge: async () => 0 }, new ServerConfirmationService(store));
  const orchestrator = new Orchestrator(registry, entitlement, pipeline, provider, model, store);
  const user = await store.createUser(`economy-${Math.random()}@test.dev`, "x");
  const account = await store.createAccountForUser(user.id);
  return { orchestrator, accountId: account.id };
}

afterEach(() => vi.unstubAllGlobals());

describe("Gemini requests per user turn", () => {
  it.each([
    ["a greeting", "Hi"],
    ["an identity question", "aapko kisne banaya?"],
  ])("%s is answered without any Gemini request", async (_label, utterance) => {
    const calls = stubGemini({ planner: [] });
    const { orchestrator, accountId } = await setup();
    await orchestrator.runTurn({ accountId, utterance });
    expect(calls).toEqual([]);
  });

  it("a plain question: 1 request (the planner answers directly)", async () => {
    const calls = stubGemini({ planner: [{ text: "Photosynthesis turns light into chemical energy." }] });
    const { orchestrator, accountId } = await setup();
    await orchestrator.runTurn({ accountId, utterance: "explain photosynthesis in one line" });
    expect(calls).toEqual(["planner"]);
  });

  it("a web search: 3 requests (plan, grounded search, answer from the sources)", async () => {
    const calls = stubGemini({ planner: [{ call: "web.search", args: { query: "Forbesganj weather tomorrow" } }, { text: "Kal Forbesganj mein dhoop rahegi." }] });
    const { orchestrator, accountId } = await setup();
    const result = await orchestrator.runTurn({ accountId, utterance: "kal Forbesganj ka weather kaisa rahega?" });
    expect(calls).toEqual(["planner", "search", "planner"]);
    expect(result.toolCalls.map((c) => c.skillId)).toEqual(["web.search"]);
  });

  it("\"poem likho\": 3 requests (plan, the poem itself, final reply that restates it)", async () => {
    const calls = stubGemini({ planner: [{ call: "creative.write_poem", args: { prompt: "monsoon" } }, { text: "Yeh rahi aapki kavita: ..." }] });
    const { orchestrator, accountId } = await setup();
    await orchestrator.runTurn({ accountId, utterance: "monsoon par ek poem likho" });
    expect(calls).toEqual(["planner", "generation", "planner"]);
  });

  it("an exhausted daily quota on the first call: exactly 1 request, then a structured error", async () => {
    const calls = stubGemini({ planner: [{ status: 429, body: quotaBody(DAILY) }] });
    const { orchestrator, accountId } = await setup();
    await expect(orchestrator.runTurn({ accountId, utterance: "write a long report on rivers" })).rejects.toMatchObject({ code: "AI_QUOTA_EXCEEDED" });
    expect(calls).toEqual(["planner"]);
  });

  it("a search that hits the daily quota: 2 requests, no re-search and no further planning", async () => {
    const calls = stubGemini({
      planner: [{ call: "web.search", args: { query: "weather" } }, { call: "web.search", args: { query: "weather forecast" } }],
      search: { status: 429, body: quotaBody(DAILY) },
    });
    const { orchestrator, accountId } = await setup();
    const result = await orchestrator.runTurn({ accountId, utterance: "kal ka weather?" });
    expect(calls).toEqual(["planner", "search"]);
    expect(result.toolCalls).toHaveLength(1);
  });
});
