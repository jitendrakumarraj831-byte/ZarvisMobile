import { Router } from "express";
import { logger } from "../../security/redact.js";
import type { Store } from "../../store/store.js";
import { TaskError, TaskNotFoundError, type TaskService } from "../../tasks/taskService.js";
import { taskView } from "../../tasks/taskView.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";

const MAX_STEPS = 20;
const MAX_STEP_CHARS = 300;
const MAX_GOAL_CHARS = 500;

/**
 * POST /api/v1/tasks, GET /, GET /:id, POST /:id/{run,resume,retry,cancel,pause}. See MASTER_SPEC.md §18.
 *
 * A task is a record with a truthful lifecycle (QUEUED, RUNNING, EXECUTING, VERIFYING, WAITING,
 * CONFIRMATION_REQUIRED, COMPLETED, FAILED, CANCELLED, BLOCKED) plus the `status` older clients
 * read. `run` (alias `resume`) starts the next step and `retry` runs a failed step again; each
 * runs ONE step as a real Orchestrator turn and answers when it has finished. Nothing runs by itself.
 */
export function tasksRouter(taskService: TaskService, store: Store): Router {
  const router = Router();
  const runLimit = rateLimit({ name: "task-run", windowMs: 60 * 1000, max: 10, keyBy: "account" });

  router.post(
    "/",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { goal, steps, projectId } = req.body ?? {};
      if (typeof goal !== "string" || goal.trim().length === 0) {
        res.status(400).json({ error: "goal is required", code: "invalid_request" });
        return;
      }
      if (goal.trim().length > MAX_GOAL_CHARS) {
        res.status(400).json({ error: `goal must be at most ${MAX_GOAL_CHARS} characters`, code: "invalid_request" });
        return;
      }
      let descriptions: string[] = [];
      if (steps !== undefined) {
        if (!Array.isArray(steps) || steps.length > MAX_STEPS || steps.some((step) => typeof step !== "string" || !step.trim() || step.trim().length > MAX_STEP_CHARS)) {
          res.status(400).json({ error: `steps must be a list of at most ${MAX_STEPS} texts of 1-${MAX_STEP_CHARS} characters`, code: "invalid_request" });
          return;
        }
        descriptions = (steps as string[]).map((step) => step.trim());
      }
      const accountId = req.auth!.accountId;
      if (projectId !== undefined && projectId !== null) {
        const project = typeof projectId === "string" ? await store.getProject(accountId, projectId) : undefined;
        if (!project) {
          res.status(404).json({ error: "Project not found", code: "project_not_found" });
          return;
        }
      }
      const task = await taskService.create(accountId, goal.trim(), "LOW", descriptions, typeof projectId === "string" ? { projectId } : {});
      res.status(201).json(taskView(task));
    }),
  );

  router.get(
    "/",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
      const tasks = (await taskService.listForAccount(req.auth!.accountId)).filter((task) => !projectId || task.projectId === projectId);
      const now = new Date();
      res.json({ tasks: tasks.map((task) => taskView(task, now)) });
    }),
  );

  router.get(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const task = await taskService.get(req.params.id!);
      if (!task || task.accountId !== (req as AuthenticatedRequest).auth!.accountId) {
        res.status(404).json({ error: "Task not found", code: "task_not_found" });
        return;
      }
      res.json(taskView(task));
    }),
  );

  for (const action of ["pause", "resume", "run", "cancel", "retry"] as const) {
    const runs = action === "resume" || action === "run" || action === "retry";
    router.post(`/:id/${action}`, requireAuth, ...(runs ? [runLimit] : []), async (req, res) => {
      try {
        const existing = await taskService.get(req.params.id!);
        if (!existing || existing.accountId !== (req as AuthenticatedRequest).auth!.accountId) {
          res.status(404).json({ error: "Task not found", code: "task_not_found" });
          return;
        }
        const task = await taskService[action === "run" ? "resume" : action](req.params.id!);
        res.json(taskView(task));
      } catch (err) {
        if (err instanceof TaskNotFoundError) {
          res.status(404).json({ error: err.message, code: err.code });
          return;
        }
        if (err instanceof TaskError) {
          res.status(409).json({ error: err.message, code: err.code });
          return;
        }
        logger.error("Task action failed", { action, error: (err instanceof Error ? err.message : String(err)).slice(0, 200) });
        res.status(500).json({ error: "Internal error", code: "internal_error" });
      }
    });
  }

  return router;
}
