import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { summarizeChecks } from "../../src/api/routes/developer.js";
import { auth, harness, newGuest, say, STORES, type Guest, type Harness } from "../helpers/api.js";

describe.each(STORES)("deleting an account removes the whole workspace (%s)", (_label, makeStore) => {
  let h: Harness;
  let me: Guest;

  beforeEach(async () => {
    h = harness(makeStore());
    me = await newGuest(h.app);
  });

  it("projects, notes, memory, files, tasks, chats and the tool ledger are all gone, and another account's are not", async () => {
    const other = await newGuest(h.app);
    for (const who of [me, other]) {
      const project = (await request(h.app).post("/api/v1/projects").set(auth(who)).send({ name: "P" })).body.id;
      await say(h.app, who, "search the web for the best phones and find results", { projectId: project });
      await request(h.app).post("/api/v1/notes").set(auth(who)).send({ kind: "decision", content: "d", projectId: project });
      await request(h.app).post("/api/v1/notes").set(auth(who)).send({ kind: "memory", content: "m" });
      await request(h.app).post("/api/v1/files/text").set(auth(who)).send({ name: "f.txt", text: "t", projectId: project });
      await request(h.app).post("/api/v1/tasks").set(auth(who)).send({ goal: "g", projectId: project });
    }
    expect((await h.store.listExecutions(me.accountId)).length).toBeGreaterThan(0);

    const res = await request(h.app).delete("/api/v1/account").set(auth(me));
    expect(res.status).toBe(204);

    expect(await h.store.listProjects(me.accountId)).toEqual([]);
    expect(await h.store.listNotes(me.accountId)).toEqual([]);
    expect(await h.store.listFiles(me.accountId)).toEqual([]);
    expect(await h.store.listExecutions(me.accountId)).toEqual([]);
    expect(await h.store.listTasksForAccount(me.accountId)).toEqual([]);
    expect(await h.store.listConversations(me.accountId)).toEqual([]);

    expect(await h.store.listProjects(other.accountId)).toHaveLength(1);
    expect((await h.store.listNotes(other.accountId)).length).toBe(2);
    expect(await h.store.listFiles(other.accountId)).toHaveLength(1);
    expect((await h.store.listExecutions(other.accountId)).length).toBeGreaterThan(0);
    expect(await h.store.listTasksForAccount(other.accountId)).toHaveLength(1);
  });
});

describe("summarizeChecks", () => {
  const check = (status: string, conclusion: string | null) => ({ name: "c", status, conclusion, url: null });

  it("counts passed, failed and pending, and treats 'no checks' as nothing — not as a pass", () => {
    expect(summarizeChecks([])).toEqual({ total: 0, passed: 0, failed: 0, pending: 0 });
    expect(summarizeChecks([check("completed", "success"), check("completed", "skipped"), check("completed", "failure"), check("in_progress", null), check("completed", "timed_out"), check("queued", null)])).toEqual({
      total: 6, passed: 2, failed: 2, pending: 2,
    });
  });
});
