export class TaskError extends Error {
  readonly code: string = "invalid_transition";
}

/**
 * Thrown when no executor is wired (a TaskService built without a runner): moving a task to
 * RUNNING would show work that is not happening, so it is refused.
 */
export class TaskExecutionUnavailableError extends TaskError {
  override readonly code = "task_execution_unavailable";
  constructor() {
    super("ZARVIS can't run tasks automatically yet, so nothing was started.");
  }
}

/** The task cannot be started from where it is (finished, cancelled, waiting for an approval ...). */
export class TaskNotRunnableError extends TaskError {
  override readonly code: string = "task_not_runnable";
}

/** Another request is running this task right now. */
export class TaskAlreadyRunningError extends TaskError {
  override readonly code = "task_already_running";
  constructor() {
    super("This task is already running. Wait for it to finish, or cancel it.");
  }
}

export class TaskNotFoundError extends TaskError {
  override readonly code = "task_not_found";
}
