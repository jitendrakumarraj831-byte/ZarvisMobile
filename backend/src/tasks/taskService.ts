import { randomUUID } from "node:crypto";
import type { RiskLevel, Task, TaskStatus, TaskStep } from "../domain/types.js";
import type { Store } from "../store/store.js";

export class TaskError extends Error {}

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING: ["RUNNING", "CANCELLED"],
  RUNNING: ["PAUSED", "DONE", "FAILED", "CANCELLED"],
  PAUSED: ["RUNNING", "CANCELLED"],
  DONE: [],
  FAILED: ["RUNNING"], // retry
  CANCELLED: [],
};

/**
 * Reusable multi-step task engine — see MASTER_SPEC.md §18. This backend slice covers
 * lifecycle transitions (pause/resume/cancel/retry) over a Task record; step execution
 * itself is produced by whichever Agent decomposed the goal (e.g. the Developer Agent
 * flow in DEVELOPER_AGENT.md) and is out of scope for this reference implementation.
 */
export class TaskService {
  constructor(private readonly store: Store) {}

  /**
   * `stepDescriptions` lets a caller (e.g. `automation.create_workflow`, SKILLS.md) seed a
   * task with a known step breakdown up front — every step starts PENDING; nothing here
   * executes them (see this class's own doc comment above: step execution is still out of
   * scope for this reference implementation, an honestly-disclosed gap, not new to this).
   */
  async create(
    accountId: string,
    goal: string,
    riskLevel: RiskLevel = "LOW",
    stepDescriptions: string[] = [],
  ): Promise<Task> {
    const steps: TaskStep[] = stepDescriptions.map((description) => ({
      id: randomUUID(),
      description,
      status: "PENDING",
      retryCount: 0,
    }));
    const task: Task = {
      id: randomUUID(),
      accountId,
      goal,
      status: "PENDING",
      steps,
      riskLevel,
      createdAt: new Date(),
    };
    return this.store.createTask(task);
  }

  async get(taskId: string): Promise<Task | undefined> {
    return this.store.getTask(taskId);
  }

  async listForAccount(accountId: string): Promise<Task[]> {
    return this.store.listTasksForAccount(accountId);
  }

  async pause(taskId: string): Promise<Task> {
    return this.transition(taskId, "PAUSED");
  }

  async resume(taskId: string): Promise<Task> {
    return this.transition(taskId, "RUNNING");
  }

  async cancel(taskId: string): Promise<Task> {
    return this.transition(taskId, "CANCELLED");
  }

  async retry(taskId: string): Promise<Task> {
    return this.transition(taskId, "RUNNING");
  }

  private async transition(taskId: string, next: TaskStatus): Promise<Task> {
    const task = await this.store.getTask(taskId);
    if (!task) {
      throw new TaskError(`Unknown task '${taskId}'`);
    }
    const allowed = VALID_TRANSITIONS[task.status];
    if (!allowed.includes(next)) {
      throw new TaskError(`Cannot move task from ${task.status} to ${next}`);
    }
    return this.store.updateTask({ ...task, status: next });
  }
}
