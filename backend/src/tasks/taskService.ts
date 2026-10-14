import { randomUUID } from "node:crypto";
import { taskLifecycle, type RiskLevel, type Task, type TaskLifecycle, type TaskStep } from "../domain/types.js";
import type { Store } from "../store/store.js";
import { TaskError, TaskExecutionUnavailableError, TaskNotFoundError } from "./errors.js";
import type { TaskRunnerPort } from "./taskRunner.js";
import { event, withEvent, withLifecycle } from "./taskState.js";

export { TaskError, TaskExecutionUnavailableError, TaskNotFoundError };

/** Lifecycles a user can cancel from: every one that has not ended. */
const CANCELLABLE: TaskLifecycle[] = ["QUEUED", "WAITING", "BLOCKED", "RUNNING", "EXECUTING", "VERIFYING", "CONFIRMATION_REQUIRED"];

export interface CreateTaskOptions {
  projectId?: string;
  conversationId?: string;
}

/**
 * The task engine's lifecycle rules over a Task record — see MASTER_SPEC.md §18.
 *
 * A task record is not proof of execution. Moving a task to a running state is only possible
 * through the TaskRunner, which runs a step as a real Orchestrator turn when the user starts it
 * and reports what that turn really did. Without a runner (`new TaskService(store)`), Run and
 * Retry are refused with `task_execution_unavailable`, exactly as before the runner existed.
 */
export class TaskService {
  constructor(
    private readonly store: Store,
    private runner?: TaskRunnerPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * The runner needs the orchestrator, which needs the skills, and the automation skills need this service: so the service is
   * built first and the runner is bound once it exists. Every holder of this one service then cancels, aborts and runs the same way.
   */
  bindRunner(runner: TaskRunnerPort): void {
    this.runner = runner;
  }

  /**
   * `stepDescriptions` lets a caller (e.g. `automation.create_workflow`, SKILLS.md) seed a task with a known step
   * breakdown up front — every step starts PENDING and the task starts QUEUED; nothing executes them until the user
   * starts a step.
   */
  async create(
    accountId: string,
    goal: string,
    riskLevel: RiskLevel = "LOW",
    stepDescriptions: string[] = [],
    options: CreateTaskOptions = {},
  ): Promise<Task> {
    const steps: TaskStep[] = stepDescriptions.map((description) => ({
      id: randomUUID(),
      description,
      status: "PENDING",
      retryCount: 0,
    }));
    const now = this.now();
    const task: Task = withEvent(
      {
        id: randomUUID(),
        accountId,
        goal,
        status: "PENDING",
        lifecycle: "QUEUED",
        steps,
        riskLevel,
        createdAt: now,
        updatedAt: now,
        retryCount: 0,
        ...(options.projectId ? { projectId: options.projectId } : {}),
        ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      },
      event("created", steps.length ? `Recorded with ${steps.length} step${steps.length === 1 ? "" : "s"}. Nothing has started.` : "Recorded. Nothing has started.", now),
    );
    return this.store.createTask(task);
  }

  async get(taskId: string): Promise<Task | undefined> {
    return this.store.getTask(taskId);
  }

  async listForAccount(accountId: string): Promise<Task[]> {
    return this.store.listTasksForAccount(accountId);
  }

  /** Legacy: older clients could pause a task a previous version left RUNNING. Only that state can be paused. */
  async pause(taskId: string): Promise<Task> {
    const task = await this.requireTask(taskId);
    if (taskLifecycle(task) !== "RUNNING") throw new TaskError(`Cannot move task from ${task.status} to PAUSED`);
    const now = this.now();
    return this.store.updateTask(withEvent(withLifecycle(task, "WAITING", now), event("paused", "Paused.", now)));
  }

  /** Starts the next step. Needs the runner. */
  async resume(taskId: string): Promise<Task> {
    const task = await this.requireTask(taskId);
    if (!this.runner) throw new TaskExecutionUnavailableError();
    return this.runner.runNext(task.accountId, taskId);
  }

  /** Runs the failed (or interrupted) step again. Needs the runner. */
  async retry(taskId: string): Promise<Task> {
    const task = await this.requireTask(taskId);
    if (!this.runner) throw new TaskExecutionUnavailableError();
    return this.runner.runNext(task.accountId, taskId);
  }

  async cancel(taskId: string): Promise<Task> {
    // The write is conditional on the state we read: if a step finished (or anything else moved the task) in between,
    // that result is not overwritten, and the cancellation is judged again against what is really stored.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const task = await this.requireTask(taskId);
      const lifecycle = taskLifecycle(task);
      if (!CANCELLABLE.includes(lifecycle)) throw new TaskError(`Cannot move task from ${task.status} to CANCELLED`);
      const now = this.now();
      this.runner?.abort(taskId);
      // A step that was running when the user cancelled did not finish: it is skipped, not "done".
      const steps = task.steps.map((step) => (step.status === "RUNNING" ? { ...step, status: "SKIPPED" as const, error: "Cancelled.", completedAt: now.toISOString() } : step));
      const written = await this.store.updateTaskIf(
        withEvent({ ...withLifecycle({ ...task, steps }, "CANCELLED", now), pendingConfirmationId: undefined, completedAt: now.toISOString() }, event("cancelled", "Cancelled by you.", now)),
        [lifecycle],
      );
      if (written) return written;
    }
    throw new TaskError("The task changed while it was being cancelled. Look at it again.");
  }

  private async requireTask(taskId: string): Promise<Task> {
    const task = await this.store.getTask(taskId);
    if (!task) throw new TaskError(`Unknown task '${taskId}'`);
    return task;
  }
}
