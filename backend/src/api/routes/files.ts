import { Router } from "express";
import multer from "multer";
import { logger } from "../../security/redact.js";
import type { Store } from "../../store/store.js";
import type { WorkspaceService } from "../../workspace/workspaceService.js";
import { fileSummaryView, fileView } from "../../workspace/views.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { sendWorkspaceError } from "./workspaceErrors.js";

/** Same ceiling as the chat attachment route: Vercel's request body limit sits just above it. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }).single("file");

/**
 * Files: what the user keeps in ZARVIS. Only the extracted (or generated) TEXT is stored; the original file is not.
 *
 * GET    /api/v1/files?projectId=<id>|none   — summaries, newest first (no text).
 * GET    /api/v1/files/:id                   — one file with its text.
 * POST   /api/v1/files/text                  — { name, text, projectId?, source? ("upload" for text read in the browser, "generated" for a saved reply) }.
 * POST   /api/v1/files/upload                — multipart `file` (+ `projectId`): PDF, DOCX or image, extracted by the same code as chat attachments.
 *                                              Answers 201 only after the text is stored.
 * PATCH  /api/v1/files/:id                   — { name?, projectId? } rename or move.
 * DELETE /api/v1/files/:id
 */
export function filesRouter(workspace: WorkspaceService, store: Store): Router {
  const router = Router();
  const writeLimit = rateLimit({ name: "files-write", windowMs: 60 * 1000, max: 60, keyBy: "account" });
  const uploadLimit = rateLimit({ name: "files-upload", windowMs: 60 * 1000, max: 20, keyBy: "account" });

  router.get(
    "/",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const raw = req.query.projectId;
      const projectId = raw === undefined ? undefined : raw === "none" ? null : String(raw);
      const files = await store.listFiles(req.auth!.accountId, projectId === undefined ? {} : { projectId });
      res.json({ files: files.map(fileSummaryView) });
    }),
  );

  router.get(
    "/:id",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        res.json(fileView(await workspace.getFile(req.auth!.accountId, req.params.id!)));
      } catch (err) {
        if (!sendWorkspaceError(err, res)) throw err;
      }
    }),
  );

  router.post(
    "/text",
    requireAuth,
    writeLimit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        const { name, text, projectId, source } = req.body ?? {};
        const file = await workspace.saveFile(req.auth!.accountId, {
          name, text, projectId,
          source: source === "generated" ? "generated" : "upload",
          mimeType: source === "generated" ? "text/markdown" : "text/plain",
        });
        res.status(201).json(fileView(file));
      } catch (err) {
        if (!sendWorkspaceError(err, res)) throw err;
      }
    }),
  );

  // The parsers are loaded when a file arrives, not at startup: if one fails to load in a deployment,
  // everything else on this router (and the whole API) keeps working and the upload says so.
  router.post(
    "/upload",
    requireAuth,
    uploadLimit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      let processUpload: typeof import("../../documents/processUpload.js").processUpload;
      try {
        ({ processUpload } = await import("../../documents/processUpload.js"));
      } catch (err) {
        logger.error("File upload failed to load", { error: err instanceof Error ? err.message : String(err) });
        res.status(503).json({ error: "File upload is temporarily unavailable", code: "upload_unavailable" });
        return;
      }
      const parseError = await new Promise<unknown>((resolve) => upload(req, res, (error: unknown) => resolve(error)));
      if (parseError) {
        const tooLarge = parseError instanceof multer.MulterError && parseError.code === "LIMIT_FILE_SIZE";
        res.status(tooLarge ? 413 : 400).json(tooLarge ? { error: "file_too_large", maxBytes: MAX_UPLOAD_BYTES } : { error: "upload_failed" });
        return;
      }
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "no_file" });
        return;
      }
      try {
        const result = await processUpload(file);
        if (!result.ok) {
          res.status(result.status).json(result.body);
          return;
        }
        const body = (req.body ?? {}) as { projectId?: unknown };
        const saved = await workspace.saveFile(req.auth!.accountId, {
          name: file.originalname,
          text: result.text,
          projectId: typeof body.projectId === "string" && body.projectId ? body.projectId : undefined,
          mimeType: file.mimetype,
          kind: result.kind === "image" ? "image" : "document",
          source: "upload",
          sizeBytes: file.size,
          ...(result.kind === "image" ? { note: "ZARVIS describes the picture in text. The picture itself is not stored." } : {}),
        });
        res.status(201).json(fileView(saved));
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
        res.json(fileView(await workspace.updateFile(req.auth!.accountId, req.params.id!, req.body ?? {})));
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
        await workspace.deleteFile(req.auth!.accountId, req.params.id!);
        res.status(204).end();
      } catch (err) {
        if (!sendWorkspaceError(err, res)) throw err;
      }
    }),
  );

  return router;
}
