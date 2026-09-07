import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { TaskError, TaskService } from "../../src/tasks/taskService.js";

describe("TaskService", () => {
  let taskService: TaskService;

  beforeEach(() => {
    taskService = new TaskService(new InMemoryStore());
  });

  it("creates a task with no steps by default", async () => {
    const task = await taskService.create("acc-1", "Audit my website");
    expect(task.steps).toEqual([]);
    expect(task.status).toBe("PENDING");
  });

  it("seeds a task with PENDING steps from the given descriptions", async () => {
    const task = await taskService.create("acc-1", "Weekly report", "LOW", ["Gather data", "Summarize", "Send"]);
    expect(task.steps).toHaveLength(3);
    expect(task.steps.map((step) => step.description)).toEqual(["Gather data", "Summarize", "Send"]);
    expect(task.steps.every((step) => step.status === "PENDING" && step.retryCount === 0)).toBe(true);
  });

  it("pauses a running task", async () => {
    const created = await taskService.create("acc-1", "Goal");
    await taskService.resume(created.id); // PENDING -> RUNNING
    const paused = await taskService.pause(created.id);
    expect(paused.status).toBe("PAUSED");
  });

  it("rejects an invalid transition", async () => {
    const created = await taskService.create("acc-1", "Goal");
    await expect(taskService.pause(created.id)).rejects.toThrow(TaskError); // PENDING -> PAUSED is not allowed
  });

  it("throws for an unknown task id", async () => {
    await expect(taskService.cancel("nope")).rejects.toThrow(TaskError);
  });
});
