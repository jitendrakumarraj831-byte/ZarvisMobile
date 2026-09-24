import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { classifyDocumentType, extractDocumentText, DocumentExtractionError } from "../../documents/extractText.js";
import { logger } from "../../security/redact.js";

/** Kept at or under Vercel's default ~4.5MB serverless request-body ceiling (no override in
 * vercel.json) — a larger cap here would just get rejected by the platform first with a
 * less useful error. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** Matches the web client's own cap for a pasted/typed document (app.js's
 * MAX_TEXT_UPLOAD_BYTES for the plain-text upload path) — one consistent ceiling for how
 * much document text a single orchestrator turn will carry, regardless of source format. */
const MAX_EXTRACTED_CHARS = 60_000;

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

  router.post(
    "/extract",
    requireAuth,
    (req, res, next) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (!err) {
          next();
          return;
        }
        const reason = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? "file_too_large" : "upload_failed";
        res.status(400).json({ error: reason });
      });
    },
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "no_file" });
        return;
      }

      const type = classifyDocumentType(file.originalname, file.mimetype);
      if (!type) {
        res.status(415).json({ error: "unsupported_file_type" });
        return;
      }

      let text: string;
      try {
        text = await extractDocumentText(file.buffer, type);
      } catch (err) {
        const cause = err instanceof DocumentExtractionError ? err.cause : err;
        logger.error("Document extraction failed", {
          type,
          sizeBytes: file.size,
          error: (cause instanceof Error ? cause.message : String(cause)).slice(0, 200),
        });
        res.status(422).json({ error: "extraction_failed" });
        return;
      }

      const trimmed = text.trim();
      if (!trimmed) {
        res.status(422).json({ error: "empty_document" });
        return;
      }
      if (trimmed.length > MAX_EXTRACTED_CHARS) {
        res.status(413).json({ error: "document_too_long", maxChars: MAX_EXTRACTED_CHARS });
        return;
      }

      res.json({ text: trimmed });
    }),
  );

  return router;
}
