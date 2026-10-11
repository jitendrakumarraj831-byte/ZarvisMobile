import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { auth, harness, newGuest, say, STORES, type Guest, type Harness } from "../helpers/api.js";

/**
 * DELETE /api/v1/conversations/:id: the web's trash icon used to hide a chat on one browser only, so the chat came back on reload and on
 * the phone. Deleting must remove the chat and every place that keeps its text, only for its owner, and a second delete must say "gone".
 */
describe.each(STORES)("delete a chat (API, %s)", (_label, makeStore) => {
  let h: Harness;
  let owner: Guest;

  const list = async (who: Guest) => (await request(h.app).get("/api/v1/conversations").set(auth(who))).body.conversations as Array<{ id: string }>;
  const del = (who: Guest, id: string) => request(h.app).delete(`/api/v1/conversations/${id}`).set(auth(who));
  const messages = (who: Guest, id: string) => request(h.app).get(`/api/v1/conversations/${id}/messages`).set(auth(who));

  beforeEach(async () => {
    h = harness(makeStore());
    owner = await newGuest(h.app);
  });

  it("needs a signed-in account", async () => {
    const chat = (await say(h.app, owner, "Plan my launch week")).conversationId;
    expect((await request(h.app).delete(`/api/v1/conversations/${chat}`)).status).toBe(401);
    expect((await messages(owner, chat)).status).toBe(200); // untouched
  });

  it("deletes the chat for good: it leaves the list and its messages are gone", async () => {
    const chat = (await say(h.app, owner, "Plan my launch week")).conversationId;
    expect((await list(owner)).map((c) => c.id)).toContain(chat);

    const res = await del(owner, chat);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");

    expect((await list(owner)).map((c) => c.id)).not.toContain(chat);
    expect((await messages(owner, chat)).status).toBe(404);
    expect((await request(h.app).get(`/api/v1/conversations/${chat}/executions`).set(auth(owner))).status).toBe(404);
    expect(await h.store.listConversationMessages(owner.accountId, chat)).toEqual([]);
  });

  it("says 404 conversation_not_found when it is already gone, so a client can treat that as done", async () => {
    const chat = (await say(h.app, owner, "Plan my launch week")).conversationId;
    expect((await del(owner, chat)).status).toBe(204);
    const again = await del(owner, chat);
    expect(again.status).toBe(404);
    expect(again.body.code).toBe("conversation_not_found");
  });

  it("answers 404 (not a server error) for an id that is not a chat id at all", async () => {
    for (const id of ["not-a-uuid", "00000000-0000-4000-8000-000000000000", "%00", "x".repeat(300)]) {
      const res = await del(owner, id);
      expect(res.status, id).toBe(404);
    }
  });

  it("only deletes the chat asked for", async () => {
    const keep = (await say(h.app, owner, "Explain photosynthesis simply")).conversationId;
    const gone = (await say(h.app, owner, "Plan my launch week")).conversationId;
    expect((await del(owner, gone)).status).toBe(204);
    expect((await list(owner)).map((c) => c.id)).toEqual([keep]);
    expect((await messages(owner, keep)).body.messages.length).toBeGreaterThan(0);
  });

  it("never deletes another account's chat: 404, and the owner still has every message", async () => {
    const stranger = await newGuest(h.app);
    const chat = (await say(h.app, owner, "Plan my launch week")).conversationId;
    const before = (await messages(owner, chat)).body.messages;

    const res = await del(stranger, chat);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("conversation_not_found");

    expect((await list(owner)).map((c) => c.id)).toContain(chat);
    expect((await messages(owner, chat)).body.messages).toEqual(before);
  });

  it("does not replay the old reply for the same clientTurnId after the chat was deleted", async () => {
    const clientTurnId = `turn-${randomUUID()}`;
    const first = await say(h.app, owner, "Plan my launch week", { clientTurnId });
    const replayedBefore = await say(h.app, owner, "Plan my launch week", { clientTurnId, conversationId: first.conversationId });
    expect((replayedBefore as { replayed?: boolean }).replayed).toBe(true); // the control: it does replay while the chat exists

    expect((await del(owner, first.conversationId)).status).toBe(204);

    const after = await say(h.app, owner, "Plan my launch week", { clientTurnId, conversationId: first.conversationId });
    expect((after as { replayed?: boolean }).replayed).toBeUndefined();
    expect(after.conversationId).not.toBe(first.conversationId); // a new chat: the old one is not brought back
    expect((await messages(owner, first.conversationId)).status).toBe(404);
  });

  it("keeps a task's history but removes the task's link to the deleted chat", async () => {
    const chat = (await say(h.app, owner, "Plan my launch week")).conversationId;
    const task = await h.store.createTask({
      id: randomUUID(), accountId: owner.accountId, goal: "Weekly report", status: "PENDING", steps: [], riskLevel: "LOW",
      createdAt: new Date(), conversationId: chat,
    });
    expect((await h.store.getTask(task.id))?.conversationId).toBe(chat);

    expect((await del(owner, chat)).status).toBe(204);

    const after = await h.store.getTask(task.id);
    expect(after?.goal).toBe("Weekly report"); // the task is still there
    expect(after?.conversationId).toBeUndefined(); // but it no longer offers to open a chat that is gone
    const view = (await request(h.app).get(`/api/v1/tasks/${task.id}`).set(auth(owner))).body;
    expect(view.conversationId ?? null).toBeNull();
  });

  it("removes the tool runs made in the chat, but keeps (unlinked) the ones that belong to a task", async () => {
    const chat = (await say(h.app, owner, "Plan my launch week")).conversationId;
    const other = (await say(h.app, owner, "Explain photosynthesis simply")).conversationId;
    const taskId = randomUUID();
    const run = (id: string, conversationId: string, extra: Record<string, unknown> = {}) => ({
      id, accountId: owner.accountId, conversationId, skillId: "web.search", skillName: "Web search", category: "research",
      status: "COMPLETED", summary: "Found results", creditsCharged: 0, createdAt: new Date(), ...extra,
    });
    const loose = randomUUID(), inTask = randomUUID(), elsewhere = randomUUID();
    await h.store.recordExecution(run(loose, chat));
    await h.store.recordExecution(run(inTask, chat, { taskId }));
    await h.store.recordExecution(run(elsewhere, other));

    expect((await del(owner, chat)).status).toBe(204);

    expect(await h.store.getExecution(owner.accountId, loose)).toBeUndefined();
    const kept = await h.store.getExecution(owner.accountId, inTask);
    expect(kept?.taskId).toBe(taskId);
    expect(kept?.conversationId).toBeUndefined();
    expect((await h.store.getExecution(owner.accountId, elsewhere))?.conversationId).toBe(other);
  });

  it("leaves a chat's project and the project itself alone", async () => {
    const project = (await request(h.app).post("/api/v1/projects").set(auth(owner)).send({ name: "Launch", goal: "Ship it" })).body.id as string;
    const chat = (await say(h.app, owner, "Plan my launch week")).conversationId;
    expect((await request(h.app).post(`/api/v1/conversations/${chat}/project`).set(auth(owner)).send({ projectId: project })).status).toBe(200);
    expect((await del(owner, chat)).status).toBe(204);
    expect((await request(h.app).get(`/api/v1/projects/${project}`).set(auth(owner))).status).toBe(200);
    expect((await request(h.app).get(`/api/v1/conversations?projectId=${project}`).set(auth(owner))).body.conversations).toEqual([]);
  });
});
