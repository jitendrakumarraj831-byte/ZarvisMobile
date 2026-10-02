import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ClientTurnIdReusedError, Orchestrator, TurnInProgressError } from "../../src/agents/orchestrator.js";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import type { AIProvider, AIRequest, AIResponse } from "../../src/ai/provider.js";
import { buildContainer } from "../../src/container.js";
import { ServerConfirmationService } from "../../src/security/confirmationService.js";
import { buildServer } from "../../src/server.js";
import { createWebSearchSkill, type SearchProvider } from "../../src/skills/webSearch.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { PostgresStore } from "../../src/store/postgresStore.js";
import type { Store } from "../../src/store/store.js";
import type { EntitlementPort } from "../../src/tooling/ports.js";
import { SkillRegistry } from "../../src/tooling/skillRegistry.js";
import { ToolPipeline } from "../../src/tooling/toolPipeline.js";

/**
 * One logical user turn (one clientTurnId) executes at most once to completion. A client that
 * re-sends it — Retry after a stream dropped once the server had finished, a double submit —
 * must not run its tools again, charge again, or store the user's message twice.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const STORES: Array<[string, () => Store]> = [
  ["in-memory store", () => new InMemoryStore()],
  ...(TEST_DATABASE_URL ? ([["postgres store", () => new PostgresStore(TEST_DATABASE_URL)]] as Array<[string, () => Store]>) : []),
];

class ScriptedProvider implements AIProvider {
  readonly id = "scripted";
  readonly requests: AIRequest[] = [];
  constructor(private readonly script: Array<AIResponse | Error | (() => Promise<AIResponse>)>) {}
  async generate(req: AIRequest): Promise<AIResponse> {
    this.requests.push(req);
    const next = this.script.shift() ?? reply("done");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  }
  async *streamGenerate(): AsyncIterable<never> {}
}

const reply = (text: string): AIResponse => ({ message: { role: "assistant", content: text }, toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 } });
const search = (query: string): AIResponse => ({
  message: { role: "assistant", content: "" },
  toolCalls: [{ id: query, skillId: "web.search", input: { query } }],
  usage: { promptTokens: 0, completionTokens: 0 },
});
const rateLimited = () => new AIProviderError("Gemini generateContent failed: 429", "AI_RATE_LIMITED", 429, true, 30_000, "per_minute");

async function setup(store: Store, script: ConstructorParameters<typeof ScriptedProvider>[0]) {
  const searchProvider: SearchProvider = {
    search: vi.fn(async () => ({ answer: "Sunny", results: [{ title: "Weather", url: "https://example.org", snippet: "" }] })),
  };
  const registry = new SkillRegistry();
  registry.register(createWebSearchSkill(searchProvider));
  const entitlement: EntitlementPort = { snapshot: async () => ({ accountId: "a", plan: "PRO", trialExpiresAt: null, creditBalance: 100 }) };
  const charge = vi.fn(async () => 0);
  const pipeline = new ToolPipeline(registry, { isGranted: async () => true }, entitlement, { charge }, new ServerConfirmationService(store));
  const provider = new ScriptedProvider(script);
  const orchestrator = new Orchestrator(registry, entitlement, pipeline, provider, { provider: "scripted", model: "m" }, store);
  const user = await store.createUser(`idem-${crypto.randomUUID()}@test.dev`, "x");
  const account = await store.createAccountForUser(user.id);
  return { orchestrator, provider, searchProvider, charge, store, accountId: account.id };
}

const roles = async (store: Store, accountId: string, conversationId: string) =>
  (await store.listConversationMessages(accountId, conversationId, 40)).map((m) => `${m.role}:${m.content}`);

describe.each(STORES)("turn idempotency (%s)", (_label, makeStore) => {
  it("replays a completed turn: no second search, model call, charge or stored message", async () => {
    const t = await setup(makeStore(), [search("weather"), reply("It is sunny.")]);
    const clientTurnId = crypto.randomUUID();

    const first = await t.orchestrator.runTurn({ accountId: t.accountId, utterance: "search the weather", clientTurnId });
    const events: string[] = [];
    const again = await t.orchestrator.runTurn({ accountId: t.accountId, utterance: "search the weather", clientTurnId }, (e) => events.push(e.type));

    expect(t.searchProvider.search).toHaveBeenCalledTimes(1);
    expect(t.provider.requests).toHaveLength(2); // plan + answer, once
    expect(t.charge).toHaveBeenCalledTimes(1);
    expect(again).toMatchObject({ message: "It is sunny.", conversationId: first.conversationId, turnId: first.turnId, replayed: true });
    expect(again.toolCalls.map((c) => c.toolCallId)).toEqual(first.toolCalls.map((c) => c.toolCallId));
    expect(events).toEqual(["conversation"]); // no thinking, no tool events: nothing ran
    expect(await roles(t.store, t.accountId, first.conversationId)).toEqual(["user:search the weather", "assistant:It is sunny."]);
  });

  it("retries a failed turn once more without storing the user's message twice", async () => {
    const t = await setup(makeStore(), [rateLimited(), reply("Here you go.")]);
    const clientTurnId = crypto.randomUUID();

    await expect(t.orchestrator.runTurn({ accountId: t.accountId, utterance: "kal ka weather?", clientTurnId })).rejects.toBeInstanceOf(AIProviderError);
    // The client never received the conversation id (e.g. the stream broke): the retry still
    // continues in the conversation the first attempt wrote to.
    const retry = await t.orchestrator.runTurn({ accountId: t.accountId, utterance: "kal ka weather?", clientTurnId });

    expect(retry.message).toBe("Here you go.");
    expect(retry.replayed).toBeUndefined();
    expect(await roles(t.store, t.accountId, retry.conversationId)).toEqual(["user:kal ka weather?", "assistant:Here you go."]);
    expect((await t.store.listConversations(t.accountId))).toHaveLength(1);
    // The model sees the message once, as the current one.
    const lastRequest = t.provider.requests.at(-1)!;
    expect(lastRequest.messages.filter((m) => m.content === "kal ka weather?")).toHaveLength(1);
  });

  it("rejects a duplicate that arrives while the first is still running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const t = await setup(makeStore(), [async () => { await gate; return reply("slow answer"); }]);
    const clientTurnId = crypto.randomUUID();

    const first = t.orchestrator.runTurn({ accountId: t.accountId, utterance: "a long question", clientTurnId });
    await vi.waitFor(() => expect(t.provider.requests).toHaveLength(1));
    await expect(t.orchestrator.runTurn({ accountId: t.accountId, utterance: "a long question", clientTurnId })).rejects.toBeInstanceOf(TurnInProgressError);
    release();

    expect((await first).message).toBe("slow answer");
    expect(t.provider.requests).toHaveLength(1);
  });

  it("keeps clientTurnIds per account: another account's identical key runs its own turn", async () => {
    const store = makeStore();
    const a = await setup(store, [reply("for A")]);
    const b = await setup(store, [reply("for B")]);
    const clientTurnId = crypto.randomUUID();

    const ra = await a.orchestrator.runTurn({ accountId: a.accountId, utterance: "question", clientTurnId });
    const rb = await b.orchestrator.runTurn({ accountId: b.accountId, utterance: "question", clientTurnId });

    expect(ra.message).toBe("for A");
    expect(rb).toMatchObject({ message: "for B" });
    expect(rb.replayed).toBeUndefined();
    expect(rb.conversationId).not.toBe(ra.conversationId);
  });

  it("refuses a clientTurnId reused for a different message: nothing runs, nothing is stored", async () => {
    const t = await setup(makeStore(), [reply("first answer"), reply("must not be used")]);
    const clientTurnId = crypto.randomUUID();
    const first = await t.orchestrator.runTurn({ accountId: t.accountId, utterance: "first question", clientTurnId });

    await expect(t.orchestrator.runTurn({ accountId: t.accountId, utterance: "a different question", clientTurnId }))
      .rejects.toBeInstanceOf(ClientTurnIdReusedError);
    expect(t.provider.requests).toHaveLength(1);
    expect(await roles(t.store, t.accountId, first.conversationId)).toEqual(["user:first question", "assistant:first answer"]);
    // The same text with surrounding whitespace is the same message.
    expect((await t.orchestrator.runTurn({ accountId: t.accountId, utterance: "  first question ", clientTurnId })).replayed).toBe(true);
  });

  it("without a clientTurnId every request is a new turn (older clients unchanged)", async () => {
    const t = await setup(makeStore(), [search("w"), reply("one"), search("w"), reply("two")]);
    await t.orchestrator.runTurn({ accountId: t.accountId, utterance: "search w" });
    await t.orchestrator.runTurn({ accountId: t.accountId, utterance: "search w" });
    expect(t.searchProvider.search).toHaveBeenCalledTimes(2);
  });

  it("deleting the account deletes its turn records", async () => {
    const t = await setup(makeStore(), [reply("ok")]);
    const clientTurnId = crypto.randomUUID();
    await t.orchestrator.runTurn({ accountId: t.accountId, utterance: "question", clientTurnId });
    await t.store.deleteAccount(t.accountId);
    // A new account can't see it, and the deleted one left nothing behind to claim.
    const user = await t.store.createUser(`idem-${crypto.randomUUID()}@test.dev`, "x");
    const other = await t.store.createAccountForUser(user.id);
    const now = new Date();
    expect(await t.store.claimTurn(other.id, clientTurnId, "f", now, new Date(0))).toEqual({ kind: "claimed" });
  });
});

describe("turn idempotency over HTTP", () => {
  async function guestApp() {
    const app = buildServer(buildContainer(new InMemoryStore()));
    const res = await request(app).post("/api/v1/auth/guest");
    return { app, auth: `Bearer ${res.body.accessToken as string}` };
  }

  it("SSE: a re-sent completed turn streams the stored reply marked replayed", async () => {
    const { app, auth } = await guestApp();
    const body = { utterance: "Hi", clientTurnId: "web-turn-12345678" };
    const first = await request(app).post("/api/v1/orchestrator/turn-stream").set("authorization", auth).send(body);
    const again = await request(app).post("/api/v1/orchestrator/turn-stream").set("authorization", auth).send(body);

    const done = (text: string) => JSON.parse(/event: done\ndata: (.*)\n/.exec(text)![1]!);
    expect(done(first.text).replayed).toBeUndefined();
    expect(done(again.text)).toMatchObject({ replayed: true, message: done(first.text).message, conversationId: done(first.text).conversationId });
    const history = await request(app).get(`/api/v1/conversations/${done(first.text).conversationId}/messages`).set("authorization", auth);
    expect(history.body.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
  });

  it("JSON route: a reused key with different text is 409 client_turn_id_reused", async () => {
    const { app, auth } = await guestApp();
    await request(app).post("/api/v1/orchestrator/turn").set("authorization", auth).send({ utterance: "Hi", clientTurnId: "json-turn-1234567" });
    const res = await request(app).post("/api/v1/orchestrator/turn").set("authorization", auth).send({ utterance: "Hello there", clientTurnId: "json-turn-1234567" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "client_turn_id_reused", retryable: false });
  });

  it("refuses a malformed clientTurnId instead of silently dropping the protection", async () => {
    const { app, auth } = await guestApp();
    const res = await request(app).post("/api/v1/orchestrator/turn").set("authorization", auth).send({ utterance: "Hi", clientTurnId: "x y" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_client_turn_id");
  });
});
