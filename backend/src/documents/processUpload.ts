import { AIProviderError, classifyGeminiFailure, providerErrorPayload, retryDelayMs, shouldTryNextModel, sleep, toProviderError } from "../ai/geminiErrors.js";
import { env } from "../config/env.js";
import { logger } from "../security/redact.js";
import { classifyDocumentType, DocumentExtractionError, extractDocumentText } from "./extractText.js";

/** Matches the web client's own cap for a pasted/typed document, and what one turn carries. */
export const MAX_EXTRACTED_CHARS = 60_000;

export const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);

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
export async function processUpload(file: UploadedFile): Promise<UploadResult> {
  if (IMAGE_MIME_TYPES.has(file.mimetype)) {
    if (!env.geminiApiKey) {
      // Honest capability state: images are supported only when a vision provider is configured.
      return { ok: false, status: 503, body: { error: "image_analysis_unavailable" } };
    }
    try {
      const text = await analyzeImageWithGemini(file.buffer, file.mimetype);
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
        // Gemini refusing the image itself (400 INVALID_ARGUMENT) is the one provider answer
        // that does mean the file could not be read. An outage or a rejected key is ours.
        if (err.status !== 400) {
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
