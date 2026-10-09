import { Router } from "express";
import type { Store } from "../../store/store.js";
import type { WorkspaceService } from "../../workspace/workspaceService.js";
import { executionView } from "../../workspace/views.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { sendWorkspaceError } from "./workspaceErrors.js";

const SKILL_ID = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

function limitOf(raw: unknown, fallback: number, max: number): number {
  const asked = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(asked) && asked > 0 ? Math.min(asked, max) : fallback;
}

/**
 * GET /api/v1/activity?projectId=&limit=  — what really happened, newest first: tool runs, task updates, saved
 * files and notes, chats, projects. Built from stored records only, so it is the same on every device.
 */
export function activityRouter(workspace: WorkspaceService): Router {
  const router = Router();
  router.get(
    "/",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        const projectId = typeof req.query.projectId === "string" && req.query.projectId ? req.query.projectId : undefined;
        res.json({ activity: await workspace.activity(req.auth!.accountId, { projectId, limit: limitOf(req.query.limit, 50, 100) }) });
      } catch (err) {
        if (!sendWorkspaceError(err, res)) throw err;
      }
    }),
  );
  return router;
}

/**
 * GET /api/v1/executions?skillIds=a.b,c.d&projectId=&limit=  — the ledger of tool executions (every call the ToolPipeline
 * evaluated for this account), newest first. Used by Research (searches and their sources) and the Developer Agent.
 * GET /api/v1/executions/:id                                 — one execution with its stored output and evidence.
 */
export function executionsRouter(store: Store): Router {
  const router = Router();
  router.get(
    "/",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const skillIds = typeof req.query.skillIds === "string" && req.query.skillIds ? req.query.skillIds.split(",").map((id) => id.trim()) : undefined;
      if (skillIds && (skillIds.length > 12 || skillIds.some((id) => !SKILL_ID.test(id)))) {
        res.status(400).json({ error: "skillIds must be a comma-separated list of skill ids.", code: "invalid_request" });
        return;
      }
      const projectId = typeof req.query.projectId === "string" && req.query.projectId ? req.query.projectId : undefined;
      const executions = await store.listExecutions(req.auth!.accountId, { ...(skillIds ? { skillIds } : {}), ...(projectId ? { projectId } : {}), limit: limitOf(req.query.limit, 30, 100) });
      res.json({ executions: executions.map(executionView) });
    }),
  );
  router.get(
    "/:id",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const execution = await store.getExecution(req.auth!.accountId, req.params.id!);
      if (!execution) {
        res.status(404).json({ error: "Execution not found", code: "execution_not_found" });
        return;
      }
      res.json(executionView(execution));
    }),
  );
  return router;
}
