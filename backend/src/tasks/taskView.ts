import { taskLifecycle, TERMINAL_LIFECYCLES, type Task, type TaskLifecycle } from "../domain/types.js";
import { isStale } from "./taskState.js";

export type TaskAction = "run" | "retry" | "cancel";

/** What the user can do next, decided here so no client has to guess from a status name. */
export function availableActions(task: Task, now: Date): TaskAction[] {
  const lifecycle = taskLifecycle(task);
  switch (lifecycle) {
    case "QUEUED":
    case "WAITING":
      return ["run", "cancel"];
    case "FAILED":
      return ["retry"];
    case "BLOCKED":
      return ["retry", "cancel"];
    case "RUNNING":
    case "EXECUTING":
    case "VERIFYING":
      return isStale(task, now) ? ["retry", "cancel"] : ["cancel"];
    case "CONFIRMATION_REQUIRED":
      return ["cancel"];
    case "COMPLETED":
    case "CANCELLED":
      return [];
  }
}

export interface TaskView {
  id: string;
  goal: string;
  /** The status older clients parse (PENDING, RUNNING, PAUSED, DONE, FAILED, CANCELLED). */
  status: Task["status"];
  /** What the task is really doing. */
  lifecycle: TaskLifecycle;
  riskLevel: Task["riskLevel"];
  createdAt: string;
  updatedAt: string;
  projectId: string | null;
  conversationId: string | null;
  steps: Task["steps"];
  /** Finished steps over all steps. Only steps a run actually finished count; a task with no steps has none. */
  progress: { done: number; total: number };
  error: Task["error"] | null;
  result: Task["result"] | null;
  events: NonNullable<Task["events"]>;
  retryCount: number;
  blockedReason: string | null;
  pendingConfirmationId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** True when a run seems to have died (no update for a while): it can be retried. */
  stale: boolean;
  actions: TaskAction[];
  /** Always false: nothing runs a task in the background. A step runs when the user starts it. */
  runsInBackground: false;
}

export function taskView(task: Task, now: Date = new Date()): TaskView {
  const lifecycle = taskLifecycle(task);
  // A skipped step (one that was running when the task was cancelled) never finished, so it is not progress.
  const done = task.steps.filter((step) => step.status === "DONE").length;
  return {
    id: task.id,
    goal: task.goal,
    status: task.status,
    lifecycle,
    riskLevel: task.riskLevel,
    createdAt: task.createdAt.toISOString(),
    updatedAt: (task.updatedAt ?? task.createdAt).toISOString(),
    projectId: task.projectId ?? null,
    conversationId: task.conversationId ?? null,
    steps: task.steps,
    progress: { done, total: task.steps.length },
    error: task.error ?? null,
    result: task.result ?? null,
    events: task.events ?? [],
    retryCount: task.retryCount ?? 0,
    blockedReason: task.blockedReason ?? null,
    pendingConfirmationId: task.pendingConfirmationId ?? null,
    startedAt: task.startedAt ?? null,
    completedAt: task.completedAt ?? null,
    stale: isStale(task, now),
    actions: availableActions(task, now),
    runsInBackground: false,
  };
}

export const isOpen = (task: Task): boolean => !TERMINAL_LIFECYCLES.includes(taskLifecycle(task));
