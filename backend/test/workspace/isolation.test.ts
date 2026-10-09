import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { auth, harness, newGuest, say, STORES, type Guest, type Harness } from "../helpers/api.js";

/**
 * Security: the workspace API is per account. Nobody signed out can reach it, and one account can never read, change,
 * move or attach to another account's projects, files, notes, tasks, chats or tool runs. A refusal is a 4xx and leaves
 * the owner's data exactly as it was.
 */
describe.each(STORES)("workspace isolation (%s)", (_label, makeStore) => {
  let h: Harness;
  let owner: Guest;
  let stranger: Guest;
  let ids: { project: string; file: string; note: string; task: string; conversation: string; execution: string };

  const as = (who: Guest) => ({
    get: (path: string) => request(h.app).get("/api/v1" + path).set(auth(who)),
    post: (path: string, body: Record<string, unknown> = {}) => request(h.app).post("/api/v1" + path).set(auth(who)).send(body),
    patch: (path: string, body: Record<string, unknown> = {}) => request(h.app).patch("/api/v1" + path).set(auth(who)).send(body),
    put: (path: string, body: Record<string, unknown> = {}) => request(h.app).put("/api/v1" + path).set(auth(who)).send(body),
    del: (path: string) => request(h.app).delete("/api/v1" + path).set(auth(who)),
  });

  beforeEach(async () => {
    h = harness(makeStore());
    owner = await newGuest(h.app);
    stranger = await newGuest(h.app);
    const me = as(owner);
    const project = (await me.post("/projects", { name: "Owner project", goal: "Private goal" })).body.id as string;
    const file = (await me.post("/files/text", { name: "private.txt", text: "private text", projectId: project })).body.id as string;
    const note = (await me.post("/notes", { kind: "decision", content: "Private decision", projectId: project })).body.id as string;
    const task = (await me.post("/tasks", { goal: "Private task", projectId: project })).body.id as string;
    const turn = await say(h.app, owner, "search and compare the best phones, find results");
    const execution = (await me.get("/executions?limit=5")).body.executions[0]?.id as string;
    ids = { project, file, note, task, conversation: turn.conversationId, execution };
    expect(Object.values(ids).every(Boolean), JSON.stringify(ids)).toBe(true);
  });

  it("every workspace route needs a signed-in account", async () => {
    const routes: Array<[string, string]> = [
      ["get", "/projects"], ["post", "/projects"], ["get", `/projects/${ids.project}`], ["patch", `/projects/${ids.project}`], ["delete", `/projects/${ids.project}`],
      ["get", "/notes"], ["post", "/notes"], ["patch", `/notes/${ids.note}`], ["delete", `/notes/${ids.note}`],
      ["get", "/memory"], ["put", "/memory/settings"], ["delete", "/memory/personal"],
      ["get", "/files"], ["get", `/files/${ids.file}`], ["post", "/files/text"], ["post", "/files/upload"], ["patch", `/files/${ids.file}`], ["delete", `/files/${ids.file}`],
      ["get", "/executions"], ["get", `/executions/${ids.execution}`], ["get", `/conversations/${ids.conversation}/executions`], ["post", `/conversations/${ids.conversation}/project`],
      ["get", "/activity"], ["get", "/agents"], ["get", "/agents/research"], ["get", "/usage/summary"], ["get", "/developer/pr-status?repoUrl=https://github.com/a/b&number=1"],
      ["get", "/tasks"], ["post", "/tasks"], ["post", `/tasks/${ids.task}/run`], ["post", `/tasks/${ids.task}/cancel`],
    ];
    const open: string[] = [];
    for (const [method, path] of routes) {
      const res = await (request(h.app) as unknown as Record<string, (p: string) => request.Test>)[method]!("/api/v1" + path);
      if (res.status !== 401) open.push(`${method.toUpperCase()} ${path} -> ${res.status}`);
    }
    expect(open).toEqual([]);
  });

  it("another account cannot read or change the owner's files, notes, tasks or tool runs", async () => {
    const them = as(stranger);
    for (const res of [
      await them.get(`/files/${ids.file}`),
      await them.patch(`/files/${ids.file}`, { name: "stolen.txt" }),
      await them.del(`/files/${ids.file}`),
      await them.patch(`/notes/${ids.note}`, { content: "overwritten" }),
      await them.del(`/notes/${ids.note}`),
      await them.get(`/executions/${ids.execution}`),
      await them.get(`/conversations/${ids.conversation}/executions`),
      await them.get(`/tasks/${ids.task}`),
      await them.post(`/tasks/${ids.task}/run`),
      await them.post(`/tasks/${ids.task}/cancel`),
    ]) {
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    }
    // And the lists show them nothing of the owner's.
    for (const path of ["/files", "/notes", "/projects", "/executions", "/activity", "/tasks"]) {
      const body = (await them.get(path)).body as Record<string, unknown[]>;
      const list = Object.values(body).find(Array.isArray) as unknown[];
      expect(list, path).toEqual([]);
    }
    expect((await them.get("/memory")).body).toMatchObject({ personal: [], projects: [] });
    // The owner's data is untouched.
    const mine = as(owner);
    expect((await mine.get(`/files/${ids.file}`)).body).toMatchObject({ name: "private.txt", text: "private text" });
    expect((await mine.get("/notes")).body.notes).toHaveLength(1);
    expect((await mine.get(`/tasks/${ids.task}`)).body.lifecycle).toBe("QUEUED");
  });

  it("another account's project cannot be attached to, and nothing is created in it", async () => {
    const them = as(stranger);
    for (const res of [
      await them.post("/files/text", { name: "x.txt", text: "hello", projectId: ids.project }),
      await them.post("/notes", { kind: "note", content: "hi", projectId: ids.project }),
      await them.post("/tasks", { goal: "sneak in", projectId: ids.project }),
      await them.patch(`/files/${ids.file}`, { projectId: ids.project }),
    ]) {
      expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    const mine = as(owner);
    const detail = (await mine.get(`/projects/${ids.project}`)).body;
    expect(detail.counts).toMatchObject({ files: 1, decisions: 1, tasks: 1 });
  });

  it("a chat cannot be moved into another account's project, and another account's chat cannot be moved at all", async () => {
    const them = as(stranger);
    const theirChat = (await say(h.app, stranger, "hello")).conversationId;
    expect((await them.post(`/conversations/${theirChat}/project`, { projectId: ids.project })).status).toBeGreaterThanOrEqual(400);
    expect((await them.post(`/conversations/${ids.conversation}/project`, { projectId: null })).status).toBe(404);
    expect((await as(owner).get(`/projects/${ids.project}`)).body.counts.conversations).toBe(0);
  });

  it("a turn naming another account's project is not run in it", async () => {
    const res = await request(h.app).post("/api/v1/orchestrator/turn").set(auth(stranger)).send({ utterance: "hello", projectId: ids.project });
    // Either refused, or run with no project: it never claims the owner's.
    if (res.status === 200) expect(res.body.projectId ?? null).toBeNull();
    else expect(res.status).toBeLessThan(500);
    expect((await as(owner).get(`/projects/${ids.project}`)).body.counts.conversations).toBe(0);
  });

  it("a research note cannot cite another account's search or a source that search did not return", async () => {
    const them = as(stranger);
    const stolen = await them.post("/notes", { kind: "research", content: "borrowed", executionId: ids.execution, sources: [{ title: "x", url: "https://example.com/a" }] });
    expect(stolen.status).toBeGreaterThanOrEqual(400);
    expect(stolen.status).toBeLessThan(500);
    const mine = as(owner);
    const invented = await mine.post("/notes", { kind: "research", content: "made up", executionId: ids.execution, sources: [{ title: "x", url: "https://example.invalid/never-returned" }] });
    expect(invented.status).toBe(400);
    expect((await mine.get("/notes?kind=research")).body.notes).toEqual([]);
  });

  it("deleting memory or an account's data only ever touches that account", async () => {
    const mine = as(owner);
    const them = as(stranger);
    await mine.post("/notes", { kind: "memory", content: "owner memory" });
    await them.post("/notes", { kind: "memory", content: "stranger memory" });
    expect((await them.del("/memory/personal")).status).toBe(200);
    const left = (await mine.get("/memory")).body;
    expect(left.personal.map((n: { content: string }) => n.content)).toEqual(["owner memory"]);
  });

  it("the pull-request status endpoint only talks to GitHub and only for a real pull request number", async () => {
    const me = as(owner);
    for (const query of [
      "repoUrl=https://evil.example/acme/demo&number=1",
      "repoUrl=http://localhost:3200/acme/demo&number=1",
      "repoUrl=https://github.com.evil.example/acme/demo&number=1",
      "repoUrl=https://github.com/acme/demo&number=abc",
      "repoUrl=https://github.com/acme/demo&number=-1",
      "repoUrl=https://github.com/acme/demo",
      "number=1",
    ]) {
      const res = await me.get("/developer/pr-status?" + query);
      expect(res.status, query).toBe(400);
    }
  });

  it("text that looks like markup is stored and returned as plain text, never changed", async () => {
    const me = as(owner);
    const html = '<img src=x onerror="window.__xss=1"><script>alert(1)</script>';
    const project = await me.post("/projects", { name: html, goal: html, description: html });
    expect(project.status).toBe(201);
    const read = await me.get(`/projects/${project.body.id}`);
    expect(read.headers["content-type"]).toMatch(/application\/json/);
    expect(read.body.project).toMatchObject({ name: html, goal: html, description: html });
    expect(read.headers["x-content-type-options"]).toBe("nosniff");
  });
});
