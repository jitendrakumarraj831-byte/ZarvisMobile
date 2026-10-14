import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "../../src/workspace/limits.js";
import { auth, harness, newGuest, say, STORES, type Guest, type Harness } from "../helpers/api.js";

describe.each(STORES)("projects (API, %s)", (_label, makeStore) => {
  let h: Harness;
  let me: Guest;

  beforeEach(async () => {
    h = harness(makeStore());
    me = await newGuest(h.app);
  });

  const create = async (body: Record<string, unknown>, who: Guest = me) => request(h.app).post("/api/v1/projects").set(auth(who)).send(body);

  it("needs a signed-in account", async () => {
    expect((await request(h.app).get("/api/v1/projects")).status).toBe(401);
    expect((await request(h.app).post("/api/v1/projects").send({ name: "x" })).status).toBe(401);
  });

  it("validates what it is given and says which field is wrong", async () => {
    expect((await create({})).body).toMatchObject({ code: "invalid_request", error: "name is required." });
    expect((await create({ name: "   " })).status).toBe(400);
    expect((await create({ name: "x".repeat(LIMITS.projectName + 1) })).body.error).toContain(String(LIMITS.projectName));
    expect((await create({ name: "ok", goal: 5 })).body.error).toBe("goal must be text.");
    expect((await create({ name: "ok", agentId: "nobody" })).body).toMatchObject({ code: "invalid_agent" });
  });

  it("creates a project and lists it with real, zero counts", async () => {
    const res = await create({ name: "Website relaunch", description: "New site", goal: "Ship by June", agentId: "research" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Website relaunch", goal: "Ship by June", status: "ACTIVE", agentId: "research" });
    const list = await request(h.app).get("/api/v1/projects").set(auth(me));
    expect(list.body.projects).toHaveLength(1);
    expect(list.body.projects[0].counts).toEqual({ conversations: 0, tasks: 0, openTasks: 0, files: 0, decisions: 0, memory: 0, research: 0, notes: 0 });
  });

  it("the detail of an empty project resumes nothing (no invented continuity)", async () => {
    const id = (await create({ name: "Empty" })).body.id;
    const detail = await request(h.app).get(`/api/v1/projects/${id}`).set(auth(me));
    expect(detail.status).toBe(200);
    expect(detail.body.continue).toMatchObject({ lastConversation: null, openTasks: [], pendingActions: [] });
    expect(detail.body.conversations).toEqual([]);
    expect(detail.body.activity).toEqual([]);
  });

  it("a chat started in a project belongs to it, and Continue work finds it with the real messages", async () => {
    const id = (await create({ name: "Launch" })).body.id;
    const turn = await say(h.app, me, "Plan my launch week", { projectId: id });
    const detail = await request(h.app).get(`/api/v1/projects/${id}`).set(auth(me));
    expect(detail.body.counts.conversations).toBe(1);
    expect(detail.body.continue.lastConversation).toMatchObject({ id: turn.conversationId, projectId: id });
    const list = await request(h.app).get(`/api/v1/conversations?projectId=${id}`).set(auth(me));
    expect(list.body.conversations.map((c: { id: string }) => c.id)).toEqual([turn.conversationId]);
    const messages = await request(h.app).get(`/api/v1/conversations/${turn.conversationId}/messages`).set(auth(me));
    expect(messages.body.projectId).toBe(id);
    expect(messages.body.messages[0].content).toBe("Plan my launch week");
  });

  it("a project id that is not the caller's is ignored: the chat is simply not in a project", async () => {
    const stranger = await newGuest(h.app);
    const theirs = (await create({ name: "Secret" }, stranger)).body.id;
    const turn = await say(h.app, me, "Hello there friend", { projectId: theirs });
    const messages = await request(h.app).get(`/api/v1/conversations/${turn.conversationId}/messages`).set(auth(me));
    expect(messages.body.projectId).toBeNull();
    const theirDetail = await request(h.app).get(`/api/v1/projects/${theirs}`).set(auth(stranger));
    expect(theirDetail.body.counts.conversations).toBe(0);
  });

  it("moves a chat into a project and out again; a project or chat that is not yours is 404", async () => {
    const id = (await create({ name: "Home" })).body.id;
    const turn = await say(h.app, me, "A loose chat about plans");
    const moved = await request(h.app).post(`/api/v1/conversations/${turn.conversationId}/project`).set(auth(me)).send({ projectId: id });
    expect(moved.body.projectId).toBe(id);
    expect((await request(h.app).get(`/api/v1/projects/${id}`).set(auth(me))).body.counts.conversations).toBe(1);
    const out = await request(h.app).post(`/api/v1/conversations/${turn.conversationId}/project`).set(auth(me)).send({ projectId: null });
    expect(out.body.projectId).toBeNull();
    const stranger = await newGuest(h.app);
    const theirProject = (await create({ name: "Theirs" }, stranger)).body.id;
    expect((await request(h.app).post(`/api/v1/conversations/${turn.conversationId}/project`).set(auth(me)).send({ projectId: theirProject })).status).toBe(404);
    expect((await request(h.app).post(`/api/v1/conversations/${turn.conversationId}/project`).set(auth(stranger)).send({ projectId: null })).status).toBe(404);
    expect((await request(h.app).post(`/api/v1/conversations/${turn.conversationId}/project`).set(auth(me)).send({ projectId: 7 })).status).toBe(400);
  });

  it("tasks created for a project are counted and resumed", async () => {
    const id = (await create({ name: "Ops" })).body.id;
    const task = await request(h.app).post("/api/v1/tasks").set(auth(me)).send({ goal: "Audit the site", steps: ["List pages", "Check links"], projectId: id });
    expect(task.status).toBe(201);
    expect(task.body.projectId).toBe(id);
    const detail = await request(h.app).get(`/api/v1/projects/${id}`).set(auth(me));
    expect(detail.body.counts).toMatchObject({ tasks: 1, openTasks: 1 });
    expect(detail.body.continue.openTasks).toEqual([{ id: task.body.id, goal: "Audit the site", lifecycle: "QUEUED" }]);
    const bad = await request(h.app).post("/api/v1/tasks").set(auth(me)).send({ goal: "x", projectId: "00000000-0000-4000-8000-000000000000" });
    expect(bad.status).toBe(404);
  });

  it("updates, archives and filters", async () => {
    const id = (await create({ name: "Old name" })).body.id;
    const patched = await request(h.app).patch(`/api/v1/projects/${id}`).set(auth(me)).send({ name: "New name", goal: "A goal", status: "ARCHIVED" });
    expect(patched.body).toMatchObject({ name: "New name", goal: "A goal", status: "ARCHIVED" });
    expect((await request(h.app).get("/api/v1/projects?status=ACTIVE").set(auth(me))).body.projects).toEqual([]);
    expect((await request(h.app).get("/api/v1/projects?status=ARCHIVED").set(auth(me))).body.projects).toHaveLength(1);
    expect((await request(h.app).patch(`/api/v1/projects/${id}`).set(auth(me)).send({ status: "DELETED" })).status).toBe(400);
    expect((await request(h.app).get("/api/v1/projects?status=NOPE").set(auth(me))).status).toBe(400);
  });

  it("deleting a project removes it and its notes, and keeps the chats and files, unassigned", async () => {
    const id = (await create({ name: "Temp" })).body.id;
    const turn = await say(h.app, me, "Chat inside the project", { projectId: id });
    await request(h.app).post("/api/v1/notes").set(auth(me)).send({ kind: "decision", content: "Use the blue logo", projectId: id });
    const file = await request(h.app).post("/api/v1/files/text").set(auth(me)).send({ name: "brief.txt", text: "hello", projectId: id });
    expect(file.status).toBe(201);
    expect((await request(h.app).delete(`/api/v1/projects/${id}`).set(auth(me))).status).toBe(204);
    expect((await request(h.app).get(`/api/v1/projects/${id}`).set(auth(me))).status).toBe(404);
    expect((await request(h.app).delete(`/api/v1/projects/${id}`).set(auth(me))).status).toBe(404);
    const messages = await request(h.app).get(`/api/v1/conversations/${turn.conversationId}/messages`).set(auth(me));
    expect(messages.status).toBe(200);
    expect(messages.body.projectId).toBeNull();
    const kept = await request(h.app).get(`/api/v1/files/${file.body.id}`).set(auth(me));
    expect(kept.body).toMatchObject({ projectId: null, text: "hello" });
    expect((await request(h.app).get("/api/v1/notes?projectId=none").set(auth(me))).body.notes).toEqual([]);
    expect(await h.store.listNotes(me.accountId)).toEqual([]);
  });

  it("restoring an archived project counts against the active-project cap, like creating one", async () => {
    const fill = async () => {
      for (let i = 0; i < LIMITS.maxProjects; i += 1) {
        await h.store.createProject({ id: crypto.randomUUID(), accountId: me.accountId, name: "P" + i, description: "", goal: "", status: "ACTIVE", createdAt: new Date(), updatedAt: new Date() });
      }
    };
    await fill();
    const patch = (id: string, body: Record<string, unknown>) => request(h.app).patch(`/api/v1/projects/${id}`).set(auth(me)).send(body);
    const list = (await request(h.app).get("/api/v1/projects").set(auth(me))).body.projects as Array<{ id: string }>;
    // Archive one, create another in its place: the account is at the cap again.
    expect((await patch(list[0]!.id, { status: "ARCHIVED" })).status).toBe(200);
    expect((await create({ name: "Takes the slot" })).status).toBe(201);
    // Restoring the archived one would be the 101st active project: refused, and it stays archived.
    const refused = await patch(list[0]!.id, { status: "ACTIVE" });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("limit_reached");
    expect((await request(h.app).get(`/api/v1/projects/${list[0]!.id}`).set(auth(me))).body.project.status).toBe("ARCHIVED");
    // Once there is room it works, and re-saving an already-active project is never blocked.
    expect((await request(h.app).delete(`/api/v1/projects/${list[1]!.id}`).set(auth(me))).status).toBe(204);
    expect((await patch(list[0]!.id, { status: "ACTIVE" })).status).toBe(200);
    expect((await patch(list[0]!.id, { status: "ACTIVE", name: "Renamed while active" })).status).toBe(200);
  });

  it("another account can neither see nor change a project", async () => {
    const id = (await create({ name: "Private" })).body.id;
    const stranger = await newGuest(h.app);
    expect((await request(h.app).get(`/api/v1/projects/${id}`).set(auth(stranger))).status).toBe(404);
    expect((await request(h.app).patch(`/api/v1/projects/${id}`).set(auth(stranger)).send({ name: "Mine now" })).status).toBe(404);
    expect((await request(h.app).delete(`/api/v1/projects/${id}`).set(auth(stranger))).status).toBe(404);
    expect((await request(h.app).get("/api/v1/projects").set(auth(stranger))).body.projects).toEqual([]);
    expect((await request(h.app).get("/api/v1/projects/not-a-uuid").set(auth(me))).status).toBe(404);
  });

  it("caps active projects per account", async () => {
    for (let i = 0; i < LIMITS.maxProjects; i += 1) {
      await h.store.createProject({ id: crypto.randomUUID(), accountId: me.accountId, name: "P" + i, description: "", goal: "", status: "ACTIVE", createdAt: new Date(), updatedAt: new Date() });
    }
    const res = await create({ name: "One too many" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("limit_reached");
  });
});
