import { randomUUID } from "node:crypto";
import { AIProviderError, providerErrorPayload } from "../ai/geminiErrors.js";
import type { Orchestrator, TurnEvent, TurnRequest, TurnResult, TurnToolCall } from "../agents/orchestrator.js";
import { taskLifecycle, type Task, type TaskLifecycle, type TaskStep, type ToolExecutionOutcome } from "../domain/types.js";
import { logger } from "../security/redact.js";
import type { ConfirmationRecord, Store } from "../store/store.js";
import { explainOutcome } from "../tooling/explainOutcome.js";
import { toStructuredResult } from "../tooling/toolResult.js";
import type { SkillRegistry } from "../tooling/skillRegistry.js";
import { TaskAlreadyRunningError, TaskNotFoundError, TaskNotRunnableError } from "./errors.js";
import { event, TASK_STALE_MS, withEvent, withLifecycle } from "./taskState.js";

export { TaskAlreadyRunningError, TaskError, TaskNotFoundError, TaskNotRunnableError } from "./errors.js";

/** What TaskService needs from an executor (the TaskRunner below, or a test double). */
export interface TaskRunnerPort {
  runNext(accountId: string, taskId: string): Promise<Task>;
  /** Stops the run in progress for this task in this process, if there is one. */
  abort(taskId: string): void;
}

const MAX_SUMMARY = 1_500;
const clip = (text: string, max = MAX_SUMMARY) => (text.length > max ? text.slice(0, max - 1) + "…" : text);

/**
 * Runs ONE step of a task when the user asks for it. A step is an ordinary Orchestrator turn
 * (the same planner, ToolPipeline, confirmations and ledger as Chat), so the task executor is
 * not a second brain. Nothing runs in the background and nothing chains on its own: after a
 * step the task WAITS for the user to start the next one.
 *
 * What the task reports comes only from what the turn really returned:
 * - a tool that failed fails the step, with the tool's own reason;
 * - an action that needs approval leaves the task CONFIRMATION_REQUIRED until that exact
 *   confirmation is approved or declined (see recordConfirmationOutcome);
 * - a step that used no tool is DONE with evidence that says so ("model reply only"), because
 *   nothing outside the conversation was done or checked.
 */
export class TaskRunner implements TaskRunnerPort {
  private readonly inflight = new Map<string, AbortController>();

  constructor(
    private readonly store: Store,
    private readonly orchestrator: Pick<Orchestrator, "runTurn">,
    private readonly registry: SkillRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  abort(taskId: string): void {
    this.inflight.get(taskId)?.abort();
  }

  async runNext(accountId: string, taskId: string): Promise<Task> {
    const started = this.now();
    const claimed = await this.store.claimTaskRun(accountId, taskId, ["QUEUED", "WAITING", "FAILED", "BLOCKED"], started, new Date(started.getTime() - TASK_STALE_MS));
    if (!claimed) {
      const existing = await this.store.getTask(taskId);
      if (!existing || existing.accountId !== accountId) throw new TaskNotFoundError(`Unknown task '${taskId}'`);
      const lifecycle = taskLifecycle(existing);
      if (lifecycle === "RUNNING" || lifecycle === "EXECUTING" || lifecycle === "VERIFYING") throw new TaskAlreadyRunningError();
      if (lifecycle === "CONFIRMATION_REQUIRED") throw new TaskNotRunnableError("This task is waiting for you to approve or decline an action. Do that first.");
      throw new TaskNotRunnableError(`A ${lifecycle.toLowerCase()} task can't be started.`);
    }

    // A task made without steps is one step: its goal.
    let task: Task = claimed.steps.length > 0 ? claimed : { ...claimed, steps: [{ id: randomUUID(), description: claimed.goal, status: "PENDING", retryCount: 0 }] };
    const index = task.steps.findIndex((step) => step.status === "PENDING" || step.status === "FAILED" || step.status === "RUNNING");
    if (index < 0) {
      // Every step is already finished (an older record): say so instead of running nothing.
      task = withEvent(withLifecycle({ ...task, result: task.result ?? { summary: lastSummary(task) }, completedAt: started.toISOString() }, "COMPLETED", started), event("completed", "All steps were already finished.", started));
      return this.store.updateTask(task);
    }
    const previous = task.steps[index]!;
    // A step that failed, or was left running by a request that died, is a new attempt of that step.
    const attempt = previous.status === "PENDING" ? previous.retryCount : previous.retryCount + 1;
    const step: TaskStep = { ...previous, status: "RUNNING", retryCount: attempt, startedAt: started.toISOString(), completedAt: undefined, error: undefined, evidence: undefined };
    const steps = task.steps.map((s, i) => (i === index ? step : s));

    let conversationId = task.conversationId;
    if (!conversationId) {
      const conversation = await this.store.createConversation(accountId, ("Task: " + task.goal).slice(0, 80), task.projectId);
      conversationId = conversation.id;
    }
    task = withEvent(
      { ...task, steps, conversationId, startedAt: task.startedAt ?? started.toISOString(), error: undefined, blockedReason: undefined, pendingConfirmationId: undefined, retryCount: (task.retryCount ?? 0) + (attempt > 0 ? 1 : 0), updatedAt: started },
      event(attempt > 0 ? "step_retried" : "step_started", `${attempt > 0 ? "Retrying" : "Starting"} step ${index + 1} of ${steps.length}: ${step.description}`, started, step.id),
    );
    task = await this.store.updateTask(task);

    const controller = new AbortController();
    this.inflight.set(task.id, controller);
    let executing: Promise<void> | undefined;
    const onEvent = (turnEvent: TurnEvent) => {
      // The first real tool start moves the task to EXECUTING; the write is best effort progress, not a result.
      if (turnEvent.type === "tool_started" && !executing) {
        executing = this.touch(task.id, "EXECUTING", `Running ${turnEvent.skillName ?? turnEvent.skillId}`, step.id);
      }
    };

    try {
      const request: TurnRequest = {
        accountId,
        utterance: stepUtterance(task, index),
        conversationId,
        taskId: task.id,
        clientTurnId: `task-${task.id}-${step.id.slice(0, 8)}-a${attempt}`,
        signal: controller.signal,
        ...(task.projectId ? { projectId: task.projectId } : {}),
      };
      let result: TurnResult;
      try {
        result = await this.orchestrator.runTurn(request, onEvent);
      } finally {
        await executing; // a progress write must land before the result is written, never after it
      }
      return await this.finishStep(task.id, step.id, result);
    } catch (err) {
      return await this.failStep(task.id, step.id, err, controller.signal.aborted);
    } finally {
      this.inflight.delete(task.id);
    }
  }

  /** Records a real mid-run state (EXECUTING, VERIFYING). Never overwrites a task that left the run. */
  private async touch(taskId: string, lifecycle: TaskLifecycle, message: string, stepId: string): Promise<void> {
    try {
      const fresh = await this.store.getTask(taskId);
      if (!fresh || !["RUNNING", "EXECUTING", "VERIFYING"].includes(taskLifecycle(fresh))) return;
      const now = this.now();
      await this.store.updateTask(withEvent(withLifecycle(fresh, lifecycle, now), event(lifecycle.toLowerCase(), message, now, stepId)));
    } catch (err) {
      logger.warn("Could not record task progress", { taskId, error: errorText(err) });
    }
  }

  private async finishStep(taskId: string, stepId: string, result: TurnResult): Promise<Task> {
    let task = await this.reload(taskId);
    if (taskLifecycle(task) === "CANCELLED") return task; // the user cancelled while it ran: keep that
    const now = this.now();
    const calls = result.toolCalls;
    const pending = calls.find((call) => call.outcome.kind === "confirmation_required");
    if (pending && pending.outcome.kind === "confirmation_required") {
      const confirmation = pending.outcome.confirmation;
      task = this.patchStep(task, stepId, { resultSummary: clip(`Waiting for your approval: ${confirmation.action}`), evidence: this.evidenceOf(calls) });
      task = withEvent({ ...withLifecycle(task, "CONFIRMATION_REQUIRED", now), pendingConfirmationId: confirmation.id }, event("confirmation_required", `Needs your approval: ${confirmation.action}`, now, stepId));
      return this.store.updateTask(task);
    }
    const failed = calls.find((call) => call.outcome.kind !== "success");
    if (failed) {
      const message = explainOutcome(failed.outcome);
      task = this.patchStep(task, stepId, { status: "FAILED", error: clip(message, 400), completedAt: now.toISOString(), evidence: this.evidenceOf(calls) });
      task = withEvent(
        { ...withLifecycle(task, "FAILED", now), error: { code: failed.result.status.toLowerCase(), message: clip(message, 400), retryable: failed.result.retryable } },
        event("step_failed", message, now, stepId),
      );
      return this.store.updateTask(task);
    }

    // The turn ran and no tool failed. Check what it produced before calling the step done.
    task = await this.store.updateTask(withEvent(withLifecycle(task, "VERIFYING", now), event("verifying", "Checking the result", now, stepId)));
    const evidence = this.evidenceOf(calls);
    const summary = clip(result.message.trim() || "(no reply)");
    task = this.patchStep(task, stepId, { status: "DONE", resultSummary: summary, completedAt: now.toISOString(), evidence });
    const more = task.steps.some((step) => step.status === "PENDING" || step.status === "FAILED");
    if (more) {
      task = withEvent(withLifecycle(task, "WAITING", now), event("step_done", "Step finished. Waiting for you to start the next one.", now, stepId));
    } else {
      task = withEvent(
        { ...withLifecycle(task, "COMPLETED", now), result: { summary: lastSummary(task) }, completedAt: now.toISOString() },
        event("completed", "Every step is finished.", now),
      );
    }
    return this.store.updateTask(task);
  }

  private async failStep(taskId: string, stepId: string, err: unknown, aborted: boolean): Promise<Task> {
    const task = await this.reload(taskId);
    if (taskLifecycle(task) === "CANCELLED") return task;
    const now = this.now();
    let failure: { code: string; message: string; retryable: boolean };
    if (err instanceof AIProviderError) {
      const payload = providerErrorPayload(err);
      failure = { code: String(payload.code).toLowerCase(), message: payload.error, retryable: payload.retryable };
    } else if (aborted || (err instanceof Error && err.name === "AbortError")) {
      failure = { code: "interrupted", message: "The run was interrupted before it finished. Nothing after the interruption was done.", retryable: true };
    } else if (err instanceof Error && (err.name === "TurnInProgressError" || err.name === "ClientTurnIdReusedError")) {
      failure = { code: "turn_conflict", message: err.message, retryable: true };
    } else {
      logger.error("Task step failed", { taskId, error: errorText(err) });
      failure = { code: "run_failed", message: "The step couldn't be completed. Please retry.", retryable: true };
    }
    let next = this.patchStep(task, stepId, { status: "FAILED", error: failure.message, completedAt: now.toISOString() });
    next = withEvent({ ...withLifecycle(next, "FAILED", now), error: failure }, event("step_failed", failure.message, now, stepId));
    return this.store.updateTask(next);
  }

  /**
   * Called when an approval that a task step was waiting for is resolved (routes/confirmations.ts).
   * The approved action ran (or was refused) there; this records what that means for the task.
   */
  async recordConfirmationOutcome(record: ConfirmationRecord, outcome: ToolExecutionOutcome): Promise<void> {
    if (!record.taskId) return;
    try {
      let task = await this.store.getTask(record.taskId);
      if (!task || task.accountId !== record.accountId || task.pendingConfirmationId !== record.id) return;
      if (taskLifecycle(task) !== "CONFIRMATION_REQUIRED") return;
      const now = this.now();
      const step = task.steps.find((s) => s.status === "RUNNING");
      const stepId = step?.id;
      if (outcome.kind === "confirmation_required") {
        // What would run changed after approval: the task keeps waiting, for the new confirmation.
        task = withEvent({ ...withLifecycle(task, "CONFIRMATION_REQUIRED", now), pendingConfirmationId: outcome.confirmation.id }, event("confirmation_required", `Needs your approval again: ${outcome.confirmation.action}`, now, stepId));
      } else if (outcome.kind === "confirmation_declined") {
        if (stepId) task = this.patchStep(task, stepId, { status: "FAILED", error: "You declined this action.", completedAt: now.toISOString() });
        task = withEvent({ ...withLifecycle(task, "BLOCKED", now), pendingConfirmationId: undefined, blockedReason: "You declined the action this step needed. Retry the step to be asked again, or cancel the task." }, event("declined", "You declined the action, so the step was not done.", now, stepId));
      } else if (outcome.kind === "success") {
        const evidence = { check: "approved_action", tools: [{ skillId: record.skillId, status: "COMPLETED", evidence: toStructuredResult(record.skillId, this.registry.find(record.skillId), outcome, explainOutcome(outcome)).verificationEvidence }] };
        if (stepId) task = this.patchStep(task, stepId, { status: "DONE", resultSummary: clip(explainOutcome(outcome)), completedAt: now.toISOString(), evidence });
        const more = task.steps.some((s) => s.status === "PENDING" || s.status === "FAILED");
        task = more
          ? withEvent({ ...withLifecycle(task, "WAITING", now), pendingConfirmationId: undefined }, event("step_done", "The approved action ran. Waiting for you to start the next step.", now, stepId))
          : withEvent({ ...withLifecycle(task, "COMPLETED", now), pendingConfirmationId: undefined, result: { summary: lastSummary(task) }, completedAt: now.toISOString() }, event("completed", "Every step is finished.", now));
      } else {
        const message = explainOutcome(outcome);
        if (stepId) task = this.patchStep(task, stepId, { status: "FAILED", error: clip(message, 400), completedAt: now.toISOString() });
        task = withEvent({ ...withLifecycle(task, "FAILED", now), pendingConfirmationId: undefined, error: { code: outcome.kind, message: clip(message, 400), retryable: true } }, event("step_failed", message, now, stepId));
      }
      await this.store.updateTask(task);
    } catch (err) {
      logger.error("Could not record a task confirmation outcome", { taskId: record.taskId, error: errorText(err) });
    }
  }

  private async reload(taskId: string): Promise<Task> {
    const task = await this.store.getTask(taskId);
    if (!task) throw new TaskNotFoundError(`Unknown task '${taskId}'`);
    return task;
  }

  private patchStep(task: Task, stepId: string, patch: Partial<TaskStep>): Task {
    return { ...task, steps: task.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)) };
  }

  private evidenceOf(calls: TurnToolCall[]): Record<string, unknown> {
    if (calls.length === 0) {
      return { check: "model_reply_only", note: "ZARVIS answered in the conversation. No tool ran, so nothing outside the conversation was done or checked." };
    }
    return {
      check: "tool_results",
      tools: calls.map((call) => ({ skillId: call.skillId, status: call.result.status, evidence: call.result.verificationEvidence })),
    };
  }
}

function lastSummary(task: Task): string {
  const done = [...task.steps].reverse().find((step) => step.status === "DONE" && step.resultSummary);
  return done?.resultSummary ?? "Every step is finished.";
}

function stepUtterance(task: Task, index: number): string {
  const lines = [`Task: ${task.goal}`, `Step ${index + 1} of ${task.steps.length}: ${task.steps[index]!.description}`];
  const finished = task.steps.slice(0, index).filter((step) => step.status === "DONE" && step.resultSummary);
  if (finished.length) {
    lines.push("", "Steps already finished:");
    finished.forEach((step, i) => lines.push(`${i + 1}. ${step.description} → ${clip(step.resultSummary!, 300)}`));
  }
  lines.push("", "Carry out only this step now. Use a tool if it needs live information or an action, and do not claim anything was done unless a tool result confirms it. Reply with the result of this step.");
  return lines.join("\n");
}

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}

