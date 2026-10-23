import { describe, expect, it } from "vitest";
import { auth, harness, newGuest, say, STORES } from "../helpers/api.js";
import request from "supertest";

describe.each(STORES)("history a browser brings to a new chat (%s)", (_label, makeStore) => {
  it("is stored in its own order, each message after the one before it", async () => {
    const h = harness(makeStore());
    const me = await newGuest(h.app);
    const history = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `message ${i + 1}` }));

    const turn = await say(h.app, me, "What did we talk about first?", { history });

    const stored = await h.store.listConversationMessages(me.accountId, turn.conversationId, 100);
    expect(stored.map((m) => m.content).slice(0, 9)).toEqual([...history.map((m) => m.content), "What did we talk about first?"]);
    // A database orders by the time alone: two messages with the same time could come back either way round.
    // The seeded history and then the current message: each strictly after the one before it.
    const times = stored.slice(0, 9).map((m) => m.createdAt.getTime());
    for (let i = 1; i < times.length; i += 1) expect(times[i]).toBeGreaterThan(times[i - 1]!);

    const listed = await request(h.app).get(`/api/v1/conversations/${turn.conversationId}/messages`).set(auth(me));
    expect(listed.body.messages.map((m: { content: string }) => m.content).slice(0, 9)).toEqual([...history.map((m) => m.content), "What did we talk about first?"]);
  });
});
