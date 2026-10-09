import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillDefinition } from "../../src/domain/types.js";
import { ServerConfirmationService } from "../../src/security/confirmationService.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { buildActivity } from "../../src/workspace/activity.js";
import { boundOutput, boundValue, previewInput, type ExecutionLogPort } from "../../src/tooling/executionRecord.js";
import { SkillRegistry } from "../../src/tooling/skillRegistry.js";
import { ToolPipeline, type PipelineStage } from "../../src/tooling/toolPipeline.js";
import type { ToolExecutionRecord } from "../../src/domain/workspace.js";
import { buildContainer } from "../../src/container.js";
import { MockGitHubClient } from "../../src/github/githubClient.js";
import { buildServer } from "../../src/server.js";
import { auth, harness, newGuest, say, STORES, type Guest, type Harness } from "../helpers/api.js";

function skill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: "test.echo", name: "Echo", description: "Echo", category: "WEB", capabilities: [], requiredPermissions: [], requiredEntitlement: "FREE",
    usageCost: { value: 2, unit: "credits" }, riskLevel: "LOW", actionClass: "READ_ONLY", requiresConfirmation: false, executesOnDevice: false,
    inputSchema: { requiredFields: ["query"] },
    handler: async (input) => ({ kind: "success", output: { echoed: input.values.query }, summary: "Echoed " + String(input.values.query) }),
    ...overrides,
  };
}

function build(skills: SkillDefinition[], log?: ExecutionLogPort) {
  const store = new InMemoryStore();
  const registry = new SkillRegistry();
  for (const s of skills) registry.register(s);
  const entitlement = { snapshot: async () => ({ accountId: "a", plan: "PRO" as const, trialExpiresAt: null, creditBalance: 100 }) };
  const pipeline = new ToolPipeline(registry, { isGranted: async () => true }, entitlement, { charge: async () => 0 }, new ServerConfirmationService(store), undefined, log);
  return { pipeline, store };
}

describe("ToolPipeline: stages and the ledger", () => {
  it("reports the stages a call really passed, in order, and writes one ledger row with the evidence", async () => {
    const rows: ToolExecutionRecord[] = [];
    const { pipeline } = build([skill()], { record: async (row) => void rows.push(row) });
    const stages: PipelineStage[] = [];
    const outcome = await pipeline.execute(
      { id: "11111111-1111-4111-8111-111111111111", skillId: "test.echo", input: { values: { query: "hello" } } },
      { accountId: "acc", conversationId: "22222222-2222-4222-8222-222222222222", projectId: "33333333-3333-4333-8333-333333333333" },
      { onStage: ({ stage }) => stages.push(stage) },
    );
    expect(outcome.kind).toBe("success");
    expect(stages).toEqual(["validated", "permitted", "entitled", "prepared", "executing", "verifying"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111", accountId: "acc", skillId: "test.echo", skillName: "Echo", status: "COMPLETED",
      output: { echoed: "hello" }, inputPreview: { query: "hello" }, creditsCharged: 2,
      projectId: "33333333-3333-4333-8333-333333333333", conversationId: "22222222-2222-4222-8222-222222222222",
    });
    expect(rows[0]!.evidence).toMatchObject({ check: "non_empty_result", outputKeys: ["echoed"] });
  });

  it("stops reporting stages where the call stopped, and still records what happened", async () => {
    const rows: ToolExecutionRecord[] = [];
    const { pipeline } = build([skill({ handler: async () => ({ kind: "failure", reason: "boom", userMessage: "It broke" }) })], { record: async (row) => void rows.push(row) });
    const stages: string[] = [];
    const outcome = await pipeline.execute({ id: "a1", skillId: "test.echo", input: { values: { query: "x" } } }, { accountId: "acc" }, { onStage: ({ stage }) => stages.push(stage) });
    expect(outcome.kind).toBe("execution_failed");
    expect(stages).toEqual(["validated", "permitted", "entitled", "prepared", "executing"]); // no "verifying": nothing succeeded
    expect(rows[0]).toMatchObject({ status: "FAILED", summary: "It broke", creditsCharged: 0 });
    expect(rows[0]!.output).toBeUndefined();

    const missing = await pipeline.execute({ id: "a2", skillId: "test.echo", input: { values: {} } }, { accountId: "acc" });
    expect(missing.kind).toBe("validation_failed");
    expect(rows[1]).toMatchObject({ status: "USER_ACTION_REQUIRED" });
  });

  it("a call that needs approval is recorded as waiting, and the approved run carries the same confirmation id", async () => {
    const rows: ToolExecutionRecord[] = [];
    const risky = skill({ id: "test.risky", name: "Risky", requiresConfirmation: true, riskLevel: "HIGH", actionClass: "EXTERNAL_COMMUNICATION" });
    const { pipeline, store } = build([risky], { record: async (row) => void rows.push(row) });
    const user = await store.createUser("approver@test.dev", "x");
    const account = await store.createAccountForUser(user.id);
    const call = { skillId: "test.risky", input: { values: { query: "go" } } };

    const first = await pipeline.execute({ id: "b1", ...call }, { accountId: account.id });
    expect(first.kind).toBe("confirmation_required");
    const pending = (first as Extract<typeof first, { kind: "confirmation_required" }>).confirmation;
    expect(rows[0]).toMatchObject({ id: "b1", status: "CONFIRMATION_REQUIRED", confirmationId: pending.id });

    const approved = await new ServerConfirmationService(store).approve(account.id, pending.id);
    expect(approved).toBeDefined();
    const stages: string[] = [];
    const second = await pipeline.execute({ id: "b2", ...call }, { accountId: account.id, confirmationGrant: approved!.grant }, { onStage: ({ stage }) => stages.push(stage) });
    expect(second.kind).toBe("success");
    expect(stages).toContain("confirmed");
    expect(rows[1]).toMatchObject({ id: "b2", status: "COMPLETED", confirmationId: pending.id });

    // The feed shows the action once, as the run it became, not as a pending request and a result.
    const feed = buildActivity({ executions: [...rows].reverse() }, 10);
    expect(feed.map((entry) => `${entry.title}: ${entry.detail}`)).toEqual(["Risky: Completed"]);
  });

  it("a ledger failure never changes the outcome", async () => {
    const { pipeline } = build([skill()], { record: async () => { throw new Error("db down"); } });
    const outcome = await pipeline.execute({ id: "c1", skillId: "test.echo", input: { values: { query: "x" } } }, { accountId: "acc" });
    expect(outcome.kind).toBe("success");
  });

  it("a throwing stage listener never changes what the pipeline does", async () => {
    const { pipeline } = build([skill()]);
    const outcome = await pipeline.execute({ id: "d1", skillId: "test.echo", input: { values: { query: "x" } } }, { accountId: "acc" }, { onStage: () => { throw new Error("listener"); } });
    expect(outcome.kind).toBe("success");
  });

  it("an unknown skill leaves no row (there is nothing to name it by)", async () => {
    const record = vi.fn(async () => undefined);
    const { pipeline } = build([skill()], { record });
    const outcome = await pipeline.execute({ id: "e1", skillId: "nope.nothing", input: { values: {} } }, { accountId: "acc" });
    expect(outcome.kind).toBe("skill_not_found");
    expect(record).not.toHaveBeenCalled();
  });
});

describe("what the ledger keeps is bounded and private", () => {
  it("bounds strings, lists and depth", () => {
    const bounded = boundValue({ long: "x".repeat(20_000), list: Array.from({ length: 100 }, (_, i) => i), deep: { a: { b: { c: { d: { e: { f: 1 } } } } } } }) as Record<string, unknown>;
    expect((bounded.long as string).length).toBe(8_000);
    expect(bounded.list as unknown[]).toHaveLength(40);
    expect(JSON.stringify(bounded.deep)).not.toContain('"f"');
  });

  it("replaces an output that is still too big with a marker, not a half-truncated document", () => {
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 40; i += 1) huge["k" + i] = "y".repeat(7_900);
    expect(boundOutput(huge)).toMatchObject({ truncated: true });
  });

  it("keeps the size of a document or a secret in the input preview, never its content", () => {
    expect(previewInput({ text: "private contract text", query: "weather", token: "ghp_abc", repoUrl: "https://github.com/a/b", n: 3 })).toEqual({
      text: "[21 characters]", query: "weather", token: "[7 characters]", repoUrl: "https://github.com/a/b", n: 3,
    });
    expect((previewInput({ query: "q".repeat(500) }).query as string).length).toBe(200);
  });
});

describe.each(STORES)("the ledger through the API (%s)", (_label, makeStore) => {
  let h: Harness;
  let me: Guest;

  beforeEach(async () => {
    h = harness(makeStore());
    me = await newGuest(h.app);
  });

  it("a web search leaves a row with its real sources; the chat can list its runs oldest first", async () => {
    const turn = await say(h.app, me, "search the web for the best phones and find results");
    const list = await request(h.app).get("/api/v1/executions?skillIds=web.search").set(auth(me));
    expect(list.status).toBe(200);
    expect(list.body.executions).toHaveLength(1);
    const row = list.body.executions[0];
    expect(row).toMatchObject({ skillId: "web.search", skillName: "Web Search", category: "WEB", status: "COMPLETED", conversationId: turn.conversationId, creditsCharged: 2 });
    expect(row.output.results[0]).toEqual(expect.objectContaining({ title: expect.any(String), url: expect.stringMatching(/^https?:\/\//) }));
    expect(row.inputPreview.query).toContain("best phones");

    const inChat = await request(h.app).get(`/api/v1/conversations/${turn.conversationId}/executions`).set(auth(me));
    expect(inChat.body.executions.map((e: { id: string }) => e.id)).toEqual([row.id]);
  });

  it("is private to the account, and a bad filter is refused", async () => {
    const turn = await say(h.app, me, "search the web for the best phones and find results");
    const stranger = await newGuest(h.app);
    expect((await request(h.app).get("/api/v1/executions").set(auth(stranger))).body.executions).toEqual([]);
    const id = turn.toolCalls[0]!.toolCallId;
    expect((await request(h.app).get(`/api/v1/executions/${id}`).set(auth(stranger))).status).toBe(404);
    expect((await request(h.app).get(`/api/v1/conversations/${turn.conversationId}/executions`).set(auth(stranger))).status).toBe(404);
    expect((await request(h.app).get("/api/v1/executions?skillIds=../../etc").set(auth(me))).status).toBe(400);
    expect((await request(h.app).get("/api/v1/executions/not-a-uuid").set(auth(me))).status).toBe(404);
  });

  it("the activity feed merges what really happened, newest first, and a project feed holds only its own", async () => {
    const project = (await request(h.app).post("/api/v1/projects").set(auth(me)).send({ name: "Feed" })).body.id;
    await say(h.app, me, "search the web for the best phones and find results", { projectId: project });
    await request(h.app).post("/api/v1/tasks").set(auth(me)).send({ goal: "Loose task" });
    await request(h.app).post("/api/v1/files/text").set(auth(me)).send({ name: "loose.txt", text: "x" });
    await request(h.app).post("/api/v1/notes").set(auth(me)).send({ kind: "memory", content: "personal memory is not activity" });

    const all = (await request(h.app).get("/api/v1/activity").set(auth(me))).body.activity as Array<{ type: string; title: string; tone: string }>;
    expect(all.map((a) => a.type).sort()).toEqual(["chat", "file", "project", "task", "tool"]);
    expect(all.some((a) => a.title.includes("personal memory"))).toBe(false);
    expect(all.find((a) => a.type === "tool")).toMatchObject({ title: "Web Search", tone: "ok", detail: "Completed" });
    expect(all.find((a) => a.type === "task")).toMatchObject({ detail: "Queued (not started)" });

    const scoped = (await request(h.app).get(`/api/v1/activity?projectId=${project}`).set(auth(me))).body.activity as Array<{ type: string }>;
    expect(scoped.map((a) => a.type).sort()).toEqual(["chat", "tool"]);
    expect((await request(h.app).get("/api/v1/activity?projectId=00000000-0000-4000-8000-000000000000").set(auth(me))).status).toBe(404);
  });

  it("a repository change asks first: the ledger shows it waiting, then once as the run it became", async () => {
    const withGithub = harnessWithGithub(makeStore());
    const pro = await newGuest(withGithub.app);
    await withGithub.store.updateAccountPlan(pro.accountId, "PRO");
    const connect = await request(withGithub.app).post("/api/v1/integrations/github").set(auth(pro)).send({ token: "ghp_" + "e".repeat(36) });
    expect(connect.status).toBe(200);

    const implement = await request(withGithub.app).post("/api/v1/developer/implement").set(auth(pro)).send({ repoUrl: "https://github.com/acme/demo", requirement: "Add a badge" });
    expect(implement.body.kind).toBe("confirmation_required");
    const waiting = (await request(withGithub.app).get("/api/v1/executions?skillIds=developer.implement").set(auth(pro))).body.executions;
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ status: "CONFIRMATION_REQUIRED", confirmationId: implement.body.confirmation.id });
    const feedWaiting = (await request(withGithub.app).get("/api/v1/activity").set(auth(pro))).body.activity;
    expect(feedWaiting.filter((a: { type: string }) => a.type === "tool")).toEqual([expect.objectContaining({ detail: "Waiting for your confirmation" })]);

    const approve = await request(withGithub.app).post(`/api/v1/confirmations/${implement.body.confirmation.id}/approve`).set(auth(pro));
    expect(approve.status).toBe(200);
    const all = (await request(withGithub.app).get("/api/v1/executions?skillIds=developer.implement").set(auth(pro))).body.executions;
    expect(all).toHaveLength(2); // the request for approval, and the run
    const run = all.find((e: { status: string }) => e.status !== "CONFIRMATION_REQUIRED");
    expect(run.confirmationId).toBe(implement.body.confirmation.id);
    const feedAfter = (await request(withGithub.app).get("/api/v1/activity").set(auth(pro))).body.activity;
    expect(feedAfter.filter((a: { type: string }) => a.type === "tool")).toHaveLength(1);
  });
});

function harnessWithGithub(store: Harness["store"]): Harness {
  const container = buildContainer(store, { githubClientFactory: (token) => new MockGitHubClient({ token, login: "alice", canPush: true }) });
  return { app: buildServer(container), container, store };
}
