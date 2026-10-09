import { Router } from "express";
import type { WorkspaceService } from "../../workspace/workspaceService.js";
import { projectView } from "../../workspace/views.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { sendWorkspaceError } from "./workspaceErrors.js";

/**
 * Projects: a place for the work that belongs together. Everything a project shows is read back from storage.
 *
 * GET    /api/v1/projects            — the account's projects with real counts (?status=ACTIVE|ARCHIVED).
 * POST   /api/v1/projects            — { name, description?, goal?, agentId? }.
 * GET    /api/v1/projects/:id        — the project, its chats, tasks, files, notes, executions, activity and what "Continue work" resumes.
 * PATCH  /api/v1/projects/:id        — name, description, goal, agentId, status.
 * DELETE /api/v1/projects/:id        — removes the project and its notes; its chats, tasks and files stay, unassigned.
 * POST   /api/v1/conversations/:id/project — see routes/conversations.ts.
 */
export function projectsRouter(workspace: WorkspaceService): Router {
  const router = Router();
  const writeLimit = rateLimit({ name: "projects-write", windowMs: 60 * 1000, max: 60, keyBy: "account" });

  router.get(
    "/",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const status = req.query.status;
      if (status !== undefined && status !== "ACTIVE" && status !== "ARCHIVED") {
        res.status(400).json({ error: "status must be ACTIVE or ARCHIVED.", code: "invalid_request" });
        return;
      }
      res.json({ projects: await workspace.listProjects(req.auth!.accountId, status) });
    }),
  );

  router.post(
    "/",
    requireAuth,
    writeLimit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        res.status(201).json(projectView(await workspace.createProject(req.auth!.accountId, req.body ?? {})));
      } catch (err) {
        if (!sendWorkspaceError(err, res)) throw err;
      }
    }),
  );

  router.get(
    "/:id",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        res.json(await workspace.projectDetail(req.auth!.accountId, req.params.id!));
      } catch (err) {
        if (!sendWorkspaceError(err, res)) throw err;
      }
    }),
  );

  router.patch(
    "/:id",
    requireAuth,
    writeLimit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        res.json(projectView(await workspace.updateProject(req.auth!.accountId, req.params.id!, req.body ?? {})));
      } catch (err) {
        if (!sendWorkspaceError(err, res)) throw err;
      }
    }),
  );

  router.delete(
    "/:id",
    requireAuth,
    writeLimit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        await workspace.deleteProject(req.auth!.accountId, req.params.id!);
        res.status(204).end();
      } catch (err) {
        if (!sendWorkspaceError(err, res)) throw err;
      }
    }),
  );

  return router;
}
