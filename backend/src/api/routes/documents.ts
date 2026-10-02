import { Router } from "express";
import { rateLimit as ipRateLimit } from "express-rate-limit";
import multer from "multer";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { classifyDocumentType, extractDocumentText, DocumentExtractionError } from "../../documents/extractText.js";
import { logger } from "../../security/redact.js";
import { env } from "../../config/env.js";
import { AIProviderError, classifyGeminiFailure, providerErrorPayload, retryDelayMs, shouldTryNextModel, sleep, toProviderError } from "../../ai/geminiErrors.js";

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

async function analyzeImageWithGemini(buffer: Buffer, mimeType: string): Promise<string> {
  if (!env.geminiApiKey) throw new DocumentExtractionError("Image analysis requires Gemini", "missing_api_key");
  const body = {
    systemInstruction: {
      parts: [{ text: "You analyze user-uploaded images. Describe what is visible, read important text, identify tables or objects, and answer as a useful assistant. Be factual and concise. Do not invent details that are not visible." }],
    },
    contents: [{
      role: "user",
      parts: [
        { text: "Analyze this uploaded image so another assistant can answer the user's questions about it. Include visible text and important visual details." },
        { inlineData: { mimeType, data: buffer.toString("base64") } },
      ],
    }],
    generationConfig: { maxOutputTokens: 4096 },
  };
  // Keep the configured model first, then use current multimodal fallbacks.
  const models = [
    env.geminiModel,
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
  ].filter((m, i, all) => m && all.indexOf(m) === i);

  // One shared retry policy (ai/geminiErrors.ts): a daily quota is never retried or moved to
  // another model, a 404 moves to the next model, transient errors back off briefly.
  const payload = JSON.stringify(body);
  let lastError: Error | undefined;
  for (const model of models) {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      try {
        response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
          { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": env.geminiApiKey }, body: payload, signal: controller.signal },
        );
      } catch (err) {
        lastError = err instanceof Error && err.name === "AbortError" ? new Error("Gemini image analysis timed out") : err instanceof Error ? err : new Error(String(err));
        const wait = retryDelayMs({ kind: "transient" }, attempt);
        if (wait === null) break;
        await sleep(wait);
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (response.ok) {
        const json = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
        if (text) return text;
        lastError = new Error("Gemini returned an empty image analysis");
        break;
      }

      const details = await response.text().catch(() => "");
      const failure = classifyGeminiFailure(response.status, details, response.headers.get("retry-after"));
      lastError = toProviderError("Gemini image analysis", response.status, response.statusText, failure, details);
      if (failure.kind === "fatal") throw lastError;
      const wait = retryDelayMs(failure, attempt);
      if (wait === null) {
        if (!shouldTryNextModel(failure)) throw lastError;
        break;
      }
      await sleep(wait);
    }
  }
  throw lastError ?? new Error("Gemini image analysis failed");
}

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

      if (IMAGE_MIME_TYPES.has(file.mimetype)) {
        if (!env.geminiApiKey) {
          // Honest capability state: images are supported only when a vision provider is configured.
          res.status(503).json({ error: "image_analysis_unavailable" });
          return;
        }
        try {
          const text = await analyzeImageWithGemini(file.buffer, file.mimetype);
          if (!text) { res.status(422).json({ error: "empty_document" }); return; }
          res.json({ text: text.slice(0, MAX_EXTRACTED_CHARS), kind: "image" });
        } catch (err) {
          logger.error("Image analysis failed", {
            mimeType: file.mimetype,
            sizeBytes: file.size,
            error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
          });
          if (err instanceof AIProviderError && err.code !== "AI_UNAVAILABLE") {
            // Out of AI quota is not "your file is unreadable": say what actually happened.
            res.status(429).json({ ...providerErrorPayload(err), error: "ai_quota_exceeded", code: err.code });
            return;
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
