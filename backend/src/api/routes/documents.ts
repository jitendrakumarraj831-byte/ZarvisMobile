import { Router } from "express";
import { rateLimit as ipRateLimit } from "express-rate-limit";
import multer from "multer";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { classifyDocumentType, extractDocumentText, DocumentExtractionError } from "../../documents/extractText.js";
import { correlationOf, runWithCorrelation } from "../../observability/requestContext.js";
import { logger } from "../../security/redact.js";
import { AIProviderError, providerErrorPayload } from "../../ai/geminiErrors.js";
import type { ModelGateway } from "../../ai/modelGateway.js";

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

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);

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

      if (IMAGE_MIME_TYPES.has(file.mimetype)) {
        // The gateway is read at request time (set by buildServer), so this router, created once
        // per process, never holds a stale one.
        const gateway = req.app.locals.modelGateway as ModelGateway | undefined;
        if (!gateway || !gateway.canAnalyzeImage(file.mimetype)) {
          // Honest capability state: images are supported only when a configured provider has a
          // vision model that accepts this image type. The upload is never silently dropped.
          res.status(503).json({ error: "image_analysis_unavailable" });
          return;
        }
        try {
          const { text } = await runWithCorrelation(correlationOf(req), () => gateway.analyzeImage({ data: file.buffer, mimeType: file.mimetype }));
          if (!text) { res.status(422).json({ error: "empty_document" }); return; }
          res.json({ text: text.slice(0, MAX_EXTRACTED_CHARS), kind: "image" });
        } catch (err) {
          logger.error("Image analysis failed", {
            mimeType: file.mimetype,
            sizeBytes: file.size,
            error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
          });
          if (err instanceof AIProviderError) {
            // A provider failure is not "your file is unreadable": say what actually happened.
            // `message` is the honest user-facing text; `error` stays a machine-readable reason.
            const { error: message, ...payload } = providerErrorPayload(err);
            if (err.code !== "AI_UNAVAILABLE") {
              res.status(429).json({ ...payload, message, error: "ai_quota_exceeded" });
              return;
            }
            // The provider refusing the image itself (a 400, e.g. Gemini INVALID_ARGUMENT) is the
            // one answer that does mean the file could not be read. An outage or a rejected key
            // is ours.
            if (err.kind !== "AI_PROVIDER_INVALID_REQUEST") {
              res.status(503).json({ ...payload, message, error: "ai_unavailable" });
              return;
            }
          }
          res.status(422).json({ error: "extraction_failed" });
        }
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
