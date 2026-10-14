import { Router } from "express";
import type { WorkspaceService } from "../../workspace/workspaceService.js";
import { noteView } from "../../workspace/views.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { sendWorkspaceError } from "./workspaceErrors.js";

/**
 * Notes: decisions, project memory, notes and research notes (projects), and personal memory (no project).
 *
 * GET    /api/v1/notes?projectId=<id>|none&kind=  — list.
 * POST   /api/v1/notes                            — { kind, content, projectId?, sources?, executionId? }. Sources are accepted only
 *                                                   when they are links from the results of that search execution.
 * PATCH  /api/v1/notes/:id                        — { content?, enabled? } (enabled: memory only; a paused memory is not used).
 * DELETE /api/v1/notes/:id
 *
 * GET    /api/v1/memory                           — what ZARVIS remembers: personal memory, project memory, and the limits that apply.
 * PUT    /api/v1/memory/settings                  — { enabled } pause or resume giving saved memory to the model.
 * DELETE /api/v1/memory/personal                  — forget all personal memory.
 *
 * Memory is only ever what the user saved here: nothing is remembered automatically.
 */
export function notesRouter(workspace: WorkspaceService): Router {
  const router = Router();
  const writeLimit = rateLimit({ name: "notes-write", windowMs: 60 * 1000, max: 90, keyBy: "account" });

  router.get(
    "/",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        const projectId = req.query.projectId === undefined ? undefined : req.query.projectId === "none" ? null : String(req.query.projectId);
        const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
        const notes = await workspace.listNotes(req.auth!.accountId, { projectId, kind });
        res.json({ notes: notes.map(noteView) });
      } catch (err) {
        if (!sendWorkspaceError(err, res)) throw err;
      }
    }),
  );

  router.post(
    "/",
    requireAuth,
    writeLimit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        res.status(201).json(noteView(await workspace.createNote(req.auth!.accountId, req.body ?? {})));
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
        res.json(noteView(await workspace.updateNote(req.auth!.accountId, req.params.id!, req.body ?? {})));
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
        await workspace.deleteNote(req.auth!.accountId, req.params.id!);
        res.status(204).end();
      } catch (err) {
        if (!sendWorkspaceError(err, res)) throw err;
      }
    }),
  );

  return router;
}

export function memoryRouter(workspace: WorkspaceService): Router {
  const router = Router();
  const writeLimit = rateLimit({ name: "memory-write", windowMs: 60 * 1000, max: 30, keyBy: "account" });

  router.get(
    "/",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      res.json(await workspace.memoryOverview(req.auth!.accountId));
    }),
  );

  router.put(
    "/settings",
    requireAuth,
    writeLimit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        res.json({ enabled: await workspace.setMemoryEnabled(req.auth!.accountId, (req.body ?? {}).enabled) });
      } catch (err) {
        if (!sendWorkspaceError(err, res)) throw err;
      }
    }),
  );

  router.delete(
    "/personal",
    requireAuth,
    writeLimit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      res.json({ removed: await workspace.forgetPersonalMemory(req.auth!.accountId) });
    }),
  );

  return router;
}
