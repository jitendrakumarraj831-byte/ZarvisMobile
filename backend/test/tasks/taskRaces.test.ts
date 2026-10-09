import { beforeEach, describe, expect, it } from "vitest";
import type { TurnResult } from "../../src/agents/orchestrator.js";
import { taskLifecycle, type Task } from "../../src/domain/types.js";
import type { Store } from "../../src/store/store.js";
import { SkillRegistry } from "../../src/tooling/skillRegistry.js";
import { TaskRunner } from "../../src/tasks/taskRunner.js";
import { TaskError, TaskService } from "../../src/tasks/taskService.js";
import { STORES } from "../helpers/api.js";

const reply = (message: string): TurnResult => ({ message, toolCalls: [], conversationId: "00000000-0000-4000-8000-000000000001", turnId: "t" });

/** Runs `hook` once, just before the next conditional task write goes to the store: the moment two writers can collide. */
function beforeNextConditionalWrite(store: Store, hook: () => Promise<unknown>): void {
  const original = store.updateTaskIf.bind(store);
  let fired = false;
  (store as { updateTaskIf: Store["updateTaskIf"] }).updateTaskIf = async (task, whileIn) => {
    if (!fired) {
      fired = true;
      await hook();
    }
    return original(task, whileIn);
  };
}

describe.each(STORES)("task writes that race (%s)", (_label, makeStore) => {
  let store: Store;
  let accountId: string;
  let service: TaskService;
  let turn: () => Promise<TurnResult>;

  beforeEach(async () => {
    store = makeStore();
    const user = await store.createUser(`race-${crypto.randomUUID()}@test.dev`, "x");
    accountId = (await store.createAccountForUser(user.id)).id;
    turn = async () => reply("done");
    const runner = new TaskRunner(store, { runTurn: async () => turn() }, new SkillRegistry());
    service = new TaskService(store, runner);
  });

  it("updateTaskIf writes only while the stored task is in one of the given states", async () => {
    const task = await service.create(accountId, "Goal", "LOW", ["One"]);
    const cancelled = { ...task, lifecycle: "CANCELLED" as const, status: "CANCELLED" as const };
    expect(await store.updateTaskIf(cancelled, ["RUNNING"])).toBeUndefined(); // it is QUEUED, not RUNNING
    expect(taskLifecycle((await store.getTask(task.id))!)).toBe("QUEUED");
    expect((await store.updateTaskIf(cancelled, ["QUEUED"]))?.lifecycle).toBe("CANCELLED");
    expect(taskLifecycle((await store.getTask(task.id))!)).toBe("CANCELLED");
    expect(await store.updateTaskIf({ ...task, lifecycle: "QUEUED" as const }, ["QUEUED"])).toBeUndefined(); // no longer queued
    expect(await store.updateTaskIf({ ...task, id: "not-a-uuid" } as Task, ["QUEUED"])).toBeUndefined();
  });

  it("a cancel that loses the race to a finishing step does not erase the step's result", async () => {
    const task = await service.create(accountId, "Goal", "LOW", ["Only step"]);
    await service.resume(task.id).catch(() => undefined); // runs the step; it finishes COMPLETED
    const done = (await store.getTask(task.id))!;
    expect(taskLifecycle(done)).toBe("COMPLETED");
    // Put it back mid-run as the cancel will read it, then let the step finish just before the cancel writes.
    const running = { ...done, lifecycle: "RUNNING" as const, status: "RUNNING" as const, steps: done.steps.map((s) => ({ ...s, status: "RUNNING" as const })) };
    await store.updateTask(running);
    beforeNextConditionalWrite(store, () => store.updateTask(done)); // the step "finishes" between the cancel's read and write
    await expect(service.cancel(task.id)).rejects.toBeInstanceOf(TaskError);
    const stored = (await store.getTask(task.id))!;
    expect(taskLifecycle(stored)).toBe("COMPLETED");
    expect(stored.steps[0]!.status).toBe("DONE");
    expect(stored.result?.summary).toBeTruthy();
  });

  it("a cancel that lands between a step's read and its write stays cancelled", async () => {
    const task = await service.create(accountId, "Goal", "LOW", ["Slow", "Next"]);
    let release!: () => void;
    let turnStarted!: () => void;
    const started = new Promise<void>((resolve) => { turnStarted = resolve; });
    turn = () => new Promise((resolve) => { release = () => resolve(reply("late")); turnStarted(); });
    const running = service.resume(task.id);
    await started; // the step really is mid-turn (no guessing with a timer: a loaded database is slow to get here)
    // The cancel arrives exactly when the runner is about to write its result.
    beforeNextConditionalWrite(store, () => service.cancel(task.id));
    release();
    const final = await running;
    expect(final.lifecycle).toBe("CANCELLED");
    const stored = (await store.getTask(task.id))!;
    expect(taskLifecycle(stored)).toBe("CANCELLED");
    expect(stored.steps.map((s) => s.status)).toEqual(["SKIPPED", "PENDING"]);
  });

  it("two cancels at once end in one cancellation, not an error loop", async () => {
    const task = await service.create(accountId, "Goal", "LOW", ["One"]);
    const results = await Promise.allSettled([service.cancel(task.id), service.cancel(task.id)]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(taskLifecycle((await store.getTask(task.id))!)).toBe("CANCELLED");
  });
});
