import { afterEach, describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../../src/agents/orchestrator.js";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import type { AIProvider, AIRequest, AIResponse } from "../../src/ai/provider.js";
import { ServerConfirmationService } from "../../src/security/confirmationService.js";
import { createWebSearchSkill, GeminiSearchProvider, type SearchProvider } from "../../src/skills/webSearch.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import type { EntitlementPort } from "../../src/tooling/ports.js";
import { SkillRegistry } from "../../src/tooling/skillRegistry.js";
import { ToolPipeline } from "../../src/tooling/toolPipeline.js";
import { DAILY, quotaBody } from "../ai/geminiFixtures.js";

/** Plays back a fixed list of model responses and records every call it receives. */
class ScriptedProvider implements AIProvider {
  readonly id = "scripted";
  readonly requests: AIRequest[] = [];
  constructor(private readonly script: Array<AIResponse | Error>) {}
  async generate(request: AIRequest): Promise<AIResponse> {
    this.requests.push(request);
    const next = this.script.shift() ?? reply("done");
    if (next instanceof Error) throw next;
    return next;
  }
  async *streamGenerate(): AsyncIterable<never> {}
}

function reply(text: string): AIResponse {
  return { message: { role: "assistant", content: text }, toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 } };
}

function search(query: string): AIResponse {
  return {
    message: { role: "assistant", content: "" },
    toolCalls: [{ id: query, skillId: "web.search", input: { query } }],
    usage: { promptTokens: 0, completionTokens: 0 },
  };
}

async function setup(provider: AIProvider, searchProvider: SearchProvider) {
  const store = new InMemoryStore();
  const registry = new SkillRegistry();
  registry.register(createWebSearchSkill(searchProvider));
  const entitlement: EntitlementPort = { snapshot: async () => ({ accountId: "a", plan: "PRO", trialExpiresAt: null, creditBalance: 100 }) };
  const charge = vi.fn(async () => 0);
  const pipeline = new ToolPipeline(registry, { isGranted: async () => true }, entitlement, { charge }, new ServerConfirmationService(store));
  const orchestrator = new Orchestrator(registry, entitlement, pipeline, provider, { provider: "scripted", model: "m" }, store);
  const user = await store.createUser(`turn-${Math.random()}@test.dev`, "x");
  const account = await store.createAccountForUser(user.id);
  return { orchestrator, accountId: account.id, charge };
}

afterEach(() => vi.unstubAllGlobals());

describe("one user turn = one intended execution", () => {
  it("a web search that hits the daily AI quota runs ONCE and ends the turn without another model call", async () => {
    // The real failure behind two identical failed Web Search cards: the search hit the Gemini
    // quota, the model saw the failure and searched again with reworded text.
    const searchFetch = vi.fn(async () => new Response(quotaBody(DAILY), { status: 429 }));
    vi.stubGlobal("fetch", searchFetch);
    const provider = new ScriptedProvider([search("weather tomorrow Forbesganj"), search("Forbesganj weather forecast tomorrow"), reply("unused")]);
    const { orchestrator, accountId, charge } = await setup(provider, new GeminiSearchProvider("k", "gemini-3.6-flash"));
    const events: string[] = [];

    const result = await orchestrator.runTurn({ accountId, utterance: "kal Forbesganj ka weather kaisa rahega?" }, (event) => events.push(event.type));

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({ skillId: "web.search", outcome: { kind: "execution_failed", result: { reason: "ai_quota_exceeded" } } });
    expect(result.toolCalls[0]?.result.status).toBe("FAILED");
    expect(result.message).toMatch(/usage limit for today/);
    expect(searchFetch).toHaveBeenCalledTimes(1); // no retry of a daily quota
    expect(provider.requests).toHaveLength(1); // no second planning call after the quota
    expect(events.filter((e) => e === "tool_started")).toHaveLength(1);
    expect(charge).not.toHaveBeenCalled(); // a failed search is never charged
  });

  it("does not re-run a skill whose service failed in this turn, even with a reworded query", async () => {
    const failing: SearchProvider = { search: vi.fn(async () => { throw new Error("socket hang up"); }) };
    const provider = new ScriptedProvider([search("best phone under 20000"), search("top phones below 20000 INR"), reply("unused")]);
    const { orchestrator, accountId } = await setup(provider, failing);

    const result = await orchestrator.runTurn({ accountId, utterance: "find the best phone under 20000" });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.outcome).toMatchObject({ kind: "execution_failed", result: { reason: "handler_error" } });
    expect(failing.search).toHaveBeenCalledTimes(1);
    expect(provider.requests).toHaveLength(2); // the model was asked once more, its repeat was not run
  });

  it("still lets the model refine a search that simply found nothing", async () => {
    let calls = 0;
    const flaky: SearchProvider = {
      search: vi.fn(async () => {
        calls += 1;
        return calls === 1 ? { answer: "", results: [] } : { answer: "A", results: [{ title: "T", url: "https://example.org", snippet: "" }] };
      }),
    };
    const provider = new ScriptedProvider([search("zzqx phone"), search("best phone under 20000"), reply("Here is what I found.")]);
    const { orchestrator, accountId } = await setup(provider, flaky);

    const result = await orchestrator.runTurn({ accountId, utterance: "find a phone" });

    expect(result.toolCalls.map((c) => c.outcome.kind)).toEqual(["execution_failed", "success"]);
    expect(result.message).toBe("Here is what I found.");
  });

  it("gives every execution its own toolCallId and returns the turnId", async () => {
    const ok: SearchProvider = { search: async () => ({ answer: "A", results: [{ title: "T", url: "https://example.org", snippet: "" }] }) };
    const provider = new ScriptedProvider([search("a"), search("b"), reply("final")]);
    const { orchestrator, accountId } = await setup(provider, ok);

    const result = await orchestrator.runTurn({ accountId, utterance: "compare a and b", turnId: "turn-123" });

    expect(result.turnId).toBe("turn-123");
    const ids = result.toolCalls.map((c) => c.toolCallId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("propagates a provider quota error as a structured AIProviderError (no fake answer)", async () => {
    const quota = new AIProviderError("Gemini generateContent failed: 429", "AI_QUOTA_EXCEEDED", 429, false, 21_000, "daily");
    const provider = new ScriptedProvider([quota]);
    const { orchestrator, accountId } = await setup(provider, { search: vi.fn() });

    await expect(orchestrator.runTurn({ accountId, utterance: "write me a long report" })).rejects.toBe(quota);
    expect(provider.requests).toHaveLength(1);
  });

  it("starts no model or tool call after the client has gone away", async () => {
    const controller = new AbortController();
    const searchProvider: SearchProvider = { search: vi.fn(async () => ({ answer: "A", results: [{ title: "T", url: "https://e.org", snippet: "" }] })) };
    const provider = new ScriptedProvider([search("a"), reply("unused")]);
    const generate = provider.generate.bind(provider);
    provider.generate = async (request) => {
      const response = await generate(request);
      controller.abort(); // the user pressed Stop while the model was planning
      return response;
    };
    const { orchestrator, accountId } = await setup(provider, searchProvider);

    const error = await orchestrator.runTurn({ accountId, utterance: "search a", signal: controller.signal }).catch((e) => e);

    expect(error.name).toBe("AbortError");
    expect(searchProvider.search).not.toHaveBeenCalled();
    expect(provider.requests).toHaveLength(1);
  });
});
