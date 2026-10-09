import { Router } from "express";
import { rateLimit as ipRateLimit } from "express-rate-limit";
import multer from "multer";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { processUpload } from "../../documents/processUpload.js";

/** Kept at or under Vercel's default ~4.5MB serverless request-body ceiling (no override in
 * vercel.json) — a larger cap here would just get rejected by the platform first with a
 * less useful error. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

/**
 * POST /api/v1/documents/extract — real text extraction for the two binary document
 * formats a browser can't read on its own (PDF, DOCX); see DEVELOPMENT.md "Document
 * upload". Plain-text formats (.txt/.md/.csv/.json/.log) never call this — the web client
 * already reads those directly with `File.text()`. This route only extracts text; it does
 * not summarize or call the AI provider — the client feeds the returned text into the
 * existing, unmodified POST /api/v1/orchestrator/turn -> docs.summarize flow, exactly as it
 * already does for pasted text.
 *
 * Never logs file contents, never echoes the underlying parser error to the client (a
 * corrupt-PDF or malformed-DOCX exception can embed byte-stream fragments in its own
 * message) — every failure path returns one of a small set of honest, generic reasons.
 */

export function documentsRouter(): Router {
  const router = Router();
  // Extraction and image analysis are not credit-charged; this per-account limit bounds cost.
  const limit = rateLimit({ name: "documents", windowMs: 60 * 1000, max: 20, keyBy: "account" });
  // This router is mounted lazily (server.ts getDocumentsRouter), so it also carries its own
  // per-IP ceiling instead of relying only on the app-level /api/v1 limiter.
  const ipLimit = ipRateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false });

  router.post(
    "/extract",
    ipLimit,
    requireAuth,
    limit,
    (req, res, next) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (!err) {
          next();
          return;
        }
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({ error: "file_too_large", maxBytes: MAX_UPLOAD_BYTES });
          return;
        }
        res.status(400).json({ error: "upload_failed" });
      });
    },
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "no_file" });
        return;
      }

      const result = await processUpload(file);
      if (!result.ok) {
        res.status(result.status).json(result.body);
        return;
      }
      res.json(result.kind === "image" ? { text: result.text, kind: "image" } : { text: result.text });
    }),
  );

  return router;
}
