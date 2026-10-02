import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildContainer } from "../../src/container.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { PostgresStore } from "../../src/store/postgresStore.js";
import type { Store } from "../../src/store/store.js";

/**
 * A client-supplied id that is not a UUID names nothing. On Postgres (UUID columns) it used to
 * be a 500 on every request carrying it, while the in-memory store answered "not found" — so
 * a stale conversation id kept in a browser made every chat turn fail, in production only.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const STORES: Array<[string, () => Store]> = [
  ["in-memory store", () => new InMemoryStore()],
  ...(TEST_DATABASE_URL ? ([["postgres store", () => new PostgresStore(TEST_DATABASE_URL)]] as Array<[string, () => Store]>) : []),
];

describe.each(STORES)("non-UUID ids from clients (%s)", (_label, makeStore) => {
  async function guest() {
    const app = buildServer(buildContainer(makeStore()));
    const res = await request(app).post("/api/v1/auth/guest");
    return { app, auth: `Bearer ${res.body.accessToken as string}` };
  }

  it("a turn with an unknown, non-UUID conversationId starts a new conversation", async () => {
    const { app, auth } = await guest();
    const res = await request(app).post("/api/v1/orchestrator/turn").set("authorization", auth).send({ utterance: "Hi", conversationId: "c-stale" });
    expect(res.status).toBe(200);
    expect(res.body.conversationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("conversation, confirmation and task routes answer 404, not 500", async () => {
    const { app, auth } = await guest();
    const messages = await request(app).get("/api/v1/conversations/not-a-uuid/messages").set("authorization", auth);
    const approve = await request(app).post("/api/v1/confirmations/not-a-uuid/approve").set("authorization", auth);
    const pause = await request(app).post("/api/v1/tasks/not-a-uuid/pause").set("authorization", auth);
    expect([messages.status, approve.status, pause.status]).toEqual([404, 404, 404]);
  });
});
