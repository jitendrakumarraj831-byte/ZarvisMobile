import type { Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildContainer } from "../../src/container.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { PostgresStore } from "../../src/store/postgresStore.js";
import type { Store } from "../../src/store/store.js";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const STORES: Array<[string, () => Store]> = [
  ["in-memory store", () => new InMemoryStore()],
  ...(TEST_DATABASE_URL ? ([["postgres store", () => new PostgresStore(TEST_DATABASE_URL)]] as Array<[string, () => Store]>) : []),
];

/** GET /api/v1/conversations: the caller's chats, newest first, so another device can list them. */
describe.each(STORES)("conversation list (API, %s)", (_label, makeStore) => {
  let app: Express;

  beforeEach(() => {
    app = buildServer(buildContainer(makeStore()));
  });

  const guest = async () => {
    const res = await request(app).post("/api/v1/auth/guest");
    expect(res.status).toBe(201);
    return res.body as { accessToken: string };
  };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const say = async (token: string, utterance: string, conversationId?: string) => {
    const res = await request(app).post("/api/v1/orchestrator/turn").set(auth(token)).send({ utterance, conversationId });
    expect(res.status).toBe(200);
    return res.body.conversationId as string;
  };

  it("needs a signed-in account", async () => {
    expect((await request(app).get("/api/v1/conversations")).status).toBe(401);
  });

  it("is empty for an account that has not said anything", async () => {
    const tokens = await guest();
    const res = await request(app).get("/api/v1/conversations").set(auth(tokens.accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ conversations: [] });
  });

  it("lists only the caller's chats, newest first, with the first message as the title", async () => {
    const tokens = await guest();
    const first = await say(tokens.accessToken, "Plan my launch week");
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await say(tokens.accessToken, "Explain photosynthesis simply");
    const stranger = await guest();
    await say(stranger.accessToken, "Someone else's secret chat");

    const res = await request(app).get("/api/v1/conversations").set(auth(tokens.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.conversations.map((c: { id: string }) => c.id)).toEqual([second, first]);
    expect(res.body.conversations.map((c: { title: string }) => c.title)).toEqual(["Explain photosynthesis simply", "Plan my launch week"]);
    for (const c of res.body.conversations) {
      expect(Object.keys(c).sort()).toEqual(["createdAt", "id", "title", "updatedAt"]); // metadata only, never messages
      expect(Number.isFinite(Date.parse(c.updatedAt))).toBe(true);
    }
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("moves a chat to the top when it gets a new message", async () => {
    const tokens = await guest();
    const first = await say(tokens.accessToken, "First chat");
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await say(tokens.accessToken, "Second chat");
    await new Promise((resolve) => setTimeout(resolve, 15));
    await say(tokens.accessToken, "Back to the first", first);
    const res = await request(app).get("/api/v1/conversations").set(auth(tokens.accessToken));
    expect(res.body.conversations.map((c: { id: string }) => c.id)).toEqual([first, second]);
  });

  it("caps the list: a limit is honoured, and a bad or huge one falls back to a safe size", async () => {
    const tokens = await guest();
    for (let i = 0; i < 3; i++) await say(tokens.accessToken, `chat ${i}`);
    const ask = async (query: string) => (await request(app).get(`/api/v1/conversations${query}`).set(auth(tokens.accessToken))).body.conversations.length;
    expect(await ask("?limit=2")).toBe(2);
    expect(await ask("?limit=1")).toBe(1);
    expect(await ask("?limit=0")).toBe(3); // not a usable limit: the default
    expect(await ask("?limit=-5")).toBe(3);
    expect(await ask("?limit=abc")).toBe(3);
    expect(await ask("?limit=100000")).toBe(3); // clamped to the maximum, which is larger than 3 here
  });

  it("a listed id opens its messages, and another account cannot open it", async () => {
    const tokens = await guest();
    const id = await say(tokens.accessToken, "hello there");
    const listed = (await request(app).get("/api/v1/conversations").set(auth(tokens.accessToken))).body.conversations[0].id;
    expect(listed).toBe(id);
    expect((await request(app).get(`/api/v1/conversations/${listed}/messages`).set(auth(tokens.accessToken))).status).toBe(200);
    const other = await guest();
    expect((await request(app).get(`/api/v1/conversations/${listed}/messages`).set(auth(other.accessToken))).status).toBe(404);
  });
});
