import { beforeEach, describe, expect, it } from "vitest";
import type { TurnEvent, TurnRequest, TurnResult, TurnToolCall } from "../../src/agents/orchestrator.js";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import type { ConfirmationRecord } from "../../src/store/store.js";
import type { ToolExecutionOutcome } from "../../src/domain/types.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { SkillRegistry } from "../../src/tooling/skillRegistry.js";
import { TaskAlreadyRunningError, TaskNotRunnableError, TaskNotFoundError } from "../../src/tasks/errors.js";
import { TaskRunner } from "../../src/tasks/taskRunner.js";
import { TaskService } from "../../src/tasks/taskService.js";
import { taskView } from "../../src/tasks/taskView.js";

type Script = (request: TurnRequest, onEvent: (event: TurnEvent) => void) => Promise<TurnResult>;

function call(skillId: string, outcome: ToolExecutionOutcome, status: string, evidence: Record<string, unknown> | null = null, retryable = false): TurnToolCall {
  return { toolCallId: "tc-" + skillId, skillId, outcome, result: { success: outcome.kind === "success", status, capabilityId: null, skillId, userSafeMessage: "msg", retryable, verificationEvidence: evidence } as TurnToolCall["result"] };
}
const ok = (skillId = "web.search"): TurnToolCall => call(skillId, { kind: "success", result: { kind: "success", output: { q: 1 }, summary: "found" }, chargedCredits: 2 }, "COMPLETED", { check: "non_empty_result" });
const reply = (message: string, toolCalls: TurnToolCall[] = []): TurnResult => ({ message, toolCalls, conversationId: "00000000-0000-4000-8000-000000000001", turnId: "t" });

describe("TaskRunner: a step is a real turn, and the task says only what happened", () => {
  let store: InMemoryStore;
  let accountId: string;
  let requests: TurnRequest[];
  let script: Script;
  let clock: Date;
  let runner: TaskRunner;
  let service: TaskService;

  beforeEach(async () => {
    store = new InMemoryStore();
    const user = await store.createUser("runner@test.dev", "x");
    accountId = (await store.createAccountForUser(user.id)).id;
    requests = [];
    clock = new Date("2026-10-08T10:00:00Z");
    script = async () => reply("Done: step result");
    runner = new TaskRunner(store, { runTurn: async (request, onEvent) => { requests.push(request); return script(request, onEvent ?? (() => {})); } }, new SkillRegistry(), () => clock);
    service = new TaskService(store, runner, () => clock);
  });

  const make = (steps: string[] = ["Gather data", "Summarize"]) => service.create(accountId, "Weekly report", "LOW", steps);

  it("starts QUEUED with no progress and nothing running", async () => {
    const task = await make();
    const view = taskView(task, clock);
    expect(view.lifecycle).toBe("QUEUED");
    expect(view.status).toBe("PENDING");
    expect(view.progress).toEqual({ done: 0, total: 2 });
    expect(view.startedAt).toBeNull();
    expect(view.events.map((e) => e.type)).toEqual(["created"]);
  });

  it("runs the first step as a turn in its own conversation, then WAITS for the user (nothing chains by itself)", async () => {
    const task = await make();
    const after = await service.resume(task.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.utterance).toContain("Task: Weekly report");
    expect(requests[0]!.utterance).toContain("Step 1 of 2: Gather data");
    expect(requests[0]!.taskId).toBe(task.id);
    expect(requests[0]!.clientTurnId).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(after.lifecycle).toBe("WAITING");
    expect(after.status).toBe("PAUSED");
    expect(after.steps.map((s) => s.status)).toEqual(["DONE", "PENDING"]);
    expect(after.steps[0]).toMatchObject({ resultSummary: "Done: step result", evidence: { check: "model_reply_only" } });
    expect(after.conversationId).toBeTruthy();
    expect((await store.getConversation(accountId, after.conversationId!))?.title).toBe("Task: Weekly report");
    expect(taskView(after, clock).progress).toEqual({ done: 1, total: 2 });
  });

  it("a step that used no tool says so: its evidence is a model reply, not a verified action", async () => {
    const task = await make(["Think about it"]);
    const done = await service.resume(task.id);
    expect(done.steps[0]!.evidence).toMatchObject({ check: "model_reply_only" });
    expect(JSON.stringify(done.steps[0]!.evidence)).toContain("nothing outside the conversation was done or checked");
  });

  it("the second step sees the first's result, and the last step COMPLETES the task with the final answer", async () => {
    const task = await make();
    await service.resume(task.id);
    script = async () => reply("Final summary", [ok()]);
    const done = await service.resume(task.id);
    expect(requests[1]!.utterance).toContain("Steps already finished:");
    expect(requests[1]!.utterance).toContain("Gather data → Done: step result");
    expect(requests[1]!.conversationId).toBe(done.conversationId);
    expect(done.lifecycle).toBe("COMPLETED");
    expect(done.status).toBe("DONE");
    expect(done.result).toEqual({ summary: "Final summary" });
    expect(done.completedAt).toBeTruthy();
    expect(done.steps[1]!.evidence).toMatchObject({ check: "tool_results", tools: [{ skillId: "web.search", status: "COMPLETED", evidence: { check: "non_empty_result" } }] });
    expect(taskView(done, clock).actions).toEqual([]);
    await expect(service.resume(task.id)).rejects.toBeInstanceOf(TaskNotRunnableError);
  });

  it("a task made without steps runs its goal as the one step", async () => {
    const task = await make([]);
    const done = await service.resume(task.id);
    expect(done.steps).toHaveLength(1);
    expect(done.steps[0]).toMatchObject({ description: "Weekly report", status: "DONE" });
    expect(done.lifecycle).toBe("COMPLETED");
  });

  it("moves through EXECUTING while a tool really runs", async () => {
    const task = await make(["Search"]);
    let seen: string | undefined;
    script = async (_request, onEvent) => {
      onEvent({ type: "tool_started", skillId: "web.search", toolCallId: "tc", skillName: "Web Search" });
      seen = (await store.getTask(task.id))?.lifecycle;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return reply("found it", [ok()]);
    };
    await service.resume(task.id);
    expect(seen).toBe("RUNNING"); // the write for EXECUTING lands before the result is written, not necessarily before the callback returns
    const events = (await store.getTask(task.id))!.events!.map((e) => e.type);
    expect(events).toEqual(["created", "step_started", "executing", "verifying", "completed"]);
  });

  it("a failed tool fails the step with the tool's own reason, and Retry runs that step again", async () => {
    const task = await make(["Search"]);
    const failing = call("web.search", { kind: "execution_failed", result: { kind: "failure", reason: "search_provider_unavailable", userMessage: "Search is down" } }, "FAILED", null, true);
    script = async () => reply("I couldn't do it", [failing]);
    const failed = await service.resume(task.id);
    expect(failed.lifecycle).toBe("FAILED");
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toMatchObject({ code: "failed", retryable: true });
    expect(failed.error!.message).toBe("Search is down");
    expect(failed.steps[0]).toMatchObject({ status: "FAILED", error: "Search is down" });
    expect(failed.result).toBeUndefined();
    expect(taskView(failed, clock).actions).toEqual(["retry"]);

    script = async () => reply("found it", [ok()]);
    const retried = await service.retry(task.id);
    expect(requests[1]!.clientTurnId).not.toBe(requests[0]!.clientTurnId); // a new attempt, not a replay of the failed one
    expect(retried.lifecycle).toBe("COMPLETED");
    expect(retried.error).toBeUndefined();
    expect(retried.steps[0]).toMatchObject({ status: "DONE", retryCount: 1 });
    expect(retried.retryCount).toBe(1);
  });

  it("an AI quota error fails the step with the real reason", async () => {
    const task = await make(["Search"]);
    script = async () => { throw new AIProviderError("quota", "AI_QUOTA_EXCEEDED", 429, false); };
    const failed = await service.resume(task.id);
    expect(failed.lifecycle).toBe("FAILED");
    expect(failed.error).toMatchObject({ code: "ai_quota_exceeded", retryable: false });
    expect(failed.error!.message).toContain("usage limit");
  });

  it("an unexpected error is reported as a failure the user can retry, without leaking its text", async () => {
    const task = await make(["Search"]);
    script = async () => { throw new Error("SELECT * FROM secrets failed at 10.0.0.5"); };
    const failed = await service.resume(task.id);
    expect(failed.error).toEqual({ code: "run_failed", message: "The step couldn't be completed. Please retry.", retryable: true });
  });

  it("an action that needs approval leaves the task CONFIRMATION_REQUIRED, and the approval decides what happens next", async () => {
    const task = await make(["Open the pull request", "Tell the team"]);
    const pending = call("developer.implement", { kind: "confirmation_required", confirmation: { id: "conf-1", skillId: "developer.implement", skillName: "Implement", action: "Open a PR in acme/demo", riskLevel: "HIGH", actionClass: "EXTERNAL_COMMUNICATION", expiresAt: "2030-01-01T00:00:00Z" } }, "CONFIRMATION_REQUIRED");
    script = async () => reply("I need your approval", [pending]);
    const waiting = await service.resume(task.id);
    expect(waiting.lifecycle).toBe("CONFIRMATION_REQUIRED");
    expect(waiting.pendingConfirmationId).toBe("conf-1");
    expect(waiting.steps[0]!.status).toBe("RUNNING");
    expect(taskView(waiting, clock).actions).toEqual(["cancel"]);
    await expect(service.resume(task.id)).rejects.toThrow(/approve or decline/);

    const record = { id: "conf-1", accountId, taskId: task.id, skillId: "developer.implement" } as ConfirmationRecord;
    await runner.recordConfirmationOutcome(record, { kind: "success", result: { kind: "success", output: {}, summary: "Opened PR #7" }, chargedCredits: 10 });
    const after = (await store.getTask(task.id))!;
    expect(after.lifecycle).toBe("WAITING");
    expect(after.steps[0]).toMatchObject({ status: "DONE", resultSummary: "Opened PR #7", evidence: { check: "approved_action" } });
    expect(after.pendingConfirmationId).toBeUndefined();
  });

  it("declining the approval BLOCKS the task and says why; nothing is marked done", async () => {
    const task = await make(["Open the pull request"]);
    const pending = call("developer.implement", { kind: "confirmation_required", confirmation: { id: "conf-2", skillId: "developer.implement", skillName: "Implement", action: "Open a PR", riskLevel: "HIGH", actionClass: "EXTERNAL_COMMUNICATION", expiresAt: "2030-01-01T00:00:00Z" } }, "CONFIRMATION_REQUIRED");
    script = async () => reply("approve please", [pending]);
    await service.resume(task.id);
    await runner.recordConfirmationOutcome({ id: "conf-2", accountId, taskId: task.id, skillId: "developer.implement" } as ConfirmationRecord, { kind: "confirmation_declined", skillId: "developer.implement" });
    const blocked = (await store.getTask(task.id))!;
    expect(blocked.lifecycle).toBe("BLOCKED");
    expect(blocked.status).toBe("PAUSED");
    expect(blocked.blockedReason).toContain("declined");
    expect(blocked.steps[0]).toMatchObject({ status: "FAILED", error: "You declined this action." });
    expect(taskView(blocked, clock).actions).toEqual(["retry", "cancel"]);
  });

  it("an approval for another task, or one the task isn't waiting for, changes nothing", async () => {
    const task = await make(["Step"]);
    await runner.recordConfirmationOutcome({ id: "unrelated", accountId, taskId: task.id, skillId: "x.y" } as ConfirmationRecord, { kind: "confirmation_declined", skillId: "x.y" });
    expect((await store.getTask(task.id))!.lifecycle).toBe("QUEUED");
  });

  it("two Run requests at once start the step once; the second is told it is already running", async () => {
    const task = await make(["Slow step"]);
    let release!: () => void;
    script = () => new Promise((resolve) => { release = () => resolve(reply("slow result")); });
    const first = service.resume(task.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(service.resume(task.id)).rejects.toBeInstanceOf(TaskAlreadyRunningError);
    release();
    expect((await first).lifecycle).toBe("COMPLETED");
    expect(requests).toHaveLength(1);
  });

  it("cancelling during a run keeps the cancellation: the late result does not bring the task back", async () => {
    const task = await make(["Slow step", "Next"]);
    let release!: () => void;
    script = () => new Promise((resolve) => { release = () => resolve(reply("late result")); });
    const running = service.resume(task.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const cancelled = await service.cancel(task.id);
    expect(cancelled.lifecycle).toBe("CANCELLED");
    expect(cancelled.steps[0]!.status).toBe("SKIPPED");
    release();
    const final = await running;
    expect(final.lifecycle).toBe("CANCELLED");
    expect((await store.getTask(task.id))!.steps.map((s) => s.status)).toEqual(["SKIPPED", "PENDING"]);
  });

  it("a run that died is shown as stale and can be retried after a while, but not before", async () => {
    const task = await make(["Step"]);
    const claimed = await store.claimTaskRun(accountId, task.id, ["QUEUED"], clock, new Date(clock.getTime() - 180_000));
    expect(claimed?.lifecycle).toBe("RUNNING");
    expect(taskView((await store.getTask(task.id))!, clock)).toMatchObject({ stale: false, actions: ["cancel"] });
    await expect(service.resume(task.id)).rejects.toBeInstanceOf(TaskAlreadyRunningError);
    clock = new Date(clock.getTime() + 4 * 60_000);
    const view = taskView((await store.getTask(task.id))!, clock);
    expect(view).toMatchObject({ stale: true, actions: ["retry", "cancel"] });
    const retried = await service.retry(task.id);
    expect(retried.lifecycle).toBe("COMPLETED");
  });

  it("only the owner can run a task; an unknown id is not found", async () => {
    const task = await make(["Step"]);
    await expect(runner.runNext("someone-else", task.id)).rejects.toBeInstanceOf(TaskNotFoundError);
    await expect(runner.runNext(accountId, "00000000-0000-4000-8000-000000000009")).rejects.toBeInstanceOf(TaskNotFoundError);
  });

  it("without a runner, Run and Retry are still refused (nothing pretends to execute)", async () => {
    const bare = new TaskService(store);
    const task = await bare.create(accountId, "Goal", "LOW", ["A"]);
    await expect(bare.resume(task.id)).rejects.toMatchObject({ code: "task_execution_unavailable" });
    await expect(bare.retry(task.id)).rejects.toMatchObject({ code: "task_execution_unavailable" });
    expect((await bare.get(task.id))!.lifecycle).toBe("QUEUED");
  });
});
