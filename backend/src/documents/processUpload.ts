import { AIProviderError, providerErrorPayload } from "../ai/geminiErrors.js";
import type { ModelGateway } from "../ai/modelGateway.js";
import { logger } from "../security/redact.js";
import {
  classifyDocumentType,
  DocumentExtractionError,
  DocumentTooLargeError,
  extractDocumentText,
} from "./extractText.js";

/** Matches the web client's own cap for a pasted/typed document, and what one turn carries. */
export const MAX_EXTRACTED_CHARS = 60_000;

export const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/** What the upload routes answer: the extracted text, or the exact HTTP status and body of the refusal. */
export type UploadResult =
  | { ok: true; text: string; kind: "image" | "document" }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Real extraction (PDF, DOCX, text) or vision analysis (images) of one uploaded file. Shared by the
 * chat attachment route and the Files library, so both give the same honest answers. Never logs file
 * contents and never echoes a parser error to the client.
 */
export async function processUpload(file: UploadedFile, deps: { gateway?: ModelGateway } = {}): Promise<UploadResult> {
  if (IMAGE_MIME_TYPES.has(file.mimetype)) {
    const gateway = deps.gateway;
    if (!gateway || !gateway.canAnalyzeImage(file.mimetype)) {
      // Honest capability state: images are supported only when a configured provider has a vision
      // model that accepts this image type. The upload is never silently dropped.
      return { ok: false, status: 503, body: { error: "image_analysis_unavailable" } };
    }
    try {
      const { text } = await gateway.analyzeImage({ data: file.buffer, mimeType: file.mimetype });
      if (!text) return { ok: false, status: 422, body: { error: "empty_document" } };
      return { ok: true, text: text.slice(0, MAX_EXTRACTED_CHARS), kind: "image" };
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
          return { ok: false, status: 429, body: { ...payload, message, error: "ai_quota_exceeded" } };
        }
        // The provider refusing the image itself (a 400, e.g. Gemini INVALID_ARGUMENT) is the one
        // answer that does mean the file could not be read. An outage or a rejected key is ours.
        if (err.kind !== "AI_PROVIDER_INVALID_REQUEST") {
          return { ok: false, status: 503, body: { ...payload, message, error: "ai_unavailable" } };
        }
      }
      return { ok: false, status: 422, body: { error: "extraction_failed" } };
    }
  }

  const type = classifyDocumentType(file.originalname, file.mimetype);
  if (!type) {
    return { ok: false, status: 415, body: { error: "unsupported_file_type" } };
  }

  let text: string;
  try {
    text = await extractDocumentText(file.buffer, type);
  } catch (err) {
    if (err instanceof DocumentTooLargeError) {
      // A small upload that unpacks to far more than a document can hold: the same answer as text
      // that is too long, reached before the parser has spent memory on it.
      logger.warn("Document refused: it unpacks to more than the limit", { type, sizeBytes: file.size });
      return { ok: false, status: 413, body: { error: "document_too_long", maxChars: MAX_EXTRACTED_CHARS } };
    }
    const cause = err instanceof DocumentExtractionError ? err.cause : err;
    logger.error("Document extraction failed", {
      type,
      sizeBytes: file.size,
      error: (cause instanceof Error ? cause.message : String(cause)).slice(0, 200),
    });
    return { ok: false, status: 422, body: { error: "extraction_failed" } };
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, status: 422, body: { error: "empty_document" } };
  }
  if (trimmed.length > MAX_EXTRACTED_CHARS) {
    return { ok: false, status: 413, body: { error: "document_too_long", maxChars: MAX_EXTRACTED_CHARS } };
  }
  return { ok: true, text: trimmed, kind: "document" };
}
