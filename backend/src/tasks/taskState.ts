import { legacyStatus, taskLifecycle, type Task, type TaskEvent, type TaskLifecycle } from "../domain/types.js";

/** A running state not touched for this long belongs to a request that died; Retry may take it over. */
export const TASK_STALE_MS = 3 * 60 * 1000;
const MAX_EVENTS = 60;

export function event(type: string, message: string, now: Date, stepId?: string): TaskEvent {
  return { at: now.toISOString(), type, message: message.slice(0, 300), ...(stepId ? { stepId } : {}) };
}

/** Appends to the task's history, keeping the newest entries. */
export function withEvent(task: Task, entry: TaskEvent): Task {
  return { ...task, events: [...(task.events ?? []), entry].slice(-MAX_EVENTS) };
}

/** Moves a task to `lifecycle`, keeping the status older clients read in step with it. */
export function withLifecycle(task: Task, lifecycle: TaskLifecycle, now: Date): Task {
  return { ...task, lifecycle, status: legacyStatus(lifecycle), updatedAt: now };
}

export const RUNNING_LIFECYCLES: readonly TaskLifecycle[] = ["RUNNING", "EXECUTING", "VERIFYING"];

export function isMidRun(task: Task): boolean {
  return RUNNING_LIFECYCLES.includes(taskLifecycle(task));
}

export function isStale(task: Task, now: Date): boolean {
  return isMidRun(task) && now.getTime() - (task.updatedAt ?? task.createdAt).getTime() > TASK_STALE_MS;
}
