import { Router } from "express";
import { TaskError, type TaskService } from "../../tasks/taskService.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";

/** POST /api/v1/tasks, GET /:id, POST /:id/{pause,resume,cancel,retry}. See MASTER_SPEC.md §18. */
export function tasksRouter(taskService: TaskService): Router {
  const router = Router();

  router.post(
    "/",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { goal } = req.body ?? {};
      if (typeof goal !== "string" || goal.trim().length === 0) {
        res.status(400).json({ error: "goal is required" });
        return;
      }
      const task = await taskService.create(req.auth!.accountId, goal);
      res.status(201).json(task);
    }),
  );

  router.get(
    "/",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      res.json({ tasks: await taskService.listForAccount(req.auth!.accountId) });
    }),
  );

  router.get(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const task = await taskService.get(req.params.id!);
      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      res.json(task);
    }),
  );

  for (const action of ["pause", "resume", "cancel", "retry"] as const) {
    router.post(`/:id/${action}`, requireAuth, async (req, res) => {
      try {
        const task = await taskService[action](req.params.id!);
        res.json(task);
      } catch (err) {
        if (err instanceof TaskError) {
          res.status(409).json({ error: err.message });
          return;
        }
        res.status(500).json({ error: "Internal error" });
      }
    });
  }

  return router;
}
