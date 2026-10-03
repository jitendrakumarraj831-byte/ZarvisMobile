import {
  AIProviderError,
  abortError,
  classifyGeminiFailure,
  retryDelayMs,
  shouldTryNextModel,
  sleep,
  toProviderError,
  type ProviderFailure,
} from "./geminiErrors.js";
import { IMAGE_ANALYSIS_MAX_OUTPUT_TOKENS, IMAGE_ANALYSIS_SYSTEM_PROMPT, IMAGE_ANALYSIS_USER_PROMPT } from "./imageAnalysisPrompts.js";
import { beginModelCall } from "./callTrace.js";
import type { ProviderTrace } from "./provider.js";
import { isAbortError, isTransportError, readJsonBody, timeoutError, transportFailure } from "./transportErrors.js";

/**
 * Gemini image understanding. Moved here, unchanged in behaviour, from the upload route
 * (`api/routes/documents.ts`) so that every AI call sits behind the ModelGateway.
 *
 * Retry policy is the shared one (ai/geminiErrors.ts): a daily quota is never retried or moved to
 * another model, a 404 moves to the next model, a 5xx is retried at most twice with backoff and
 * then moves on, any other 4xx fails at once. A request that outlives its time budget is NOT
 * retried (the provider may still be working on it): it is reported as a timeout.
 */
export interface GeminiVisionOptions {
  apiKey: string;
  /** Tried in order: the configured model first, then current multimodal fallbacks. */
  models: string[];
  baseUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  trace?: ProviderTrace;
  modelCallId?: string;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TIMEOUT_MS = 60_000;

interface GeminiVisionResponse {
  responseId?: string;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

export async function analyzeImageWithGemini(buffer: Buffer, mimeType: string, options: GeminiVisionOptions): Promise<string> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const label = "Gemini image analysis";
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: IMAGE_ANALYSIS_SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [{ text: IMAGE_ANALYSIS_USER_PROMPT }, { inlineData: { mimeType, data: buffer.toString("base64") } }],
      },
    ],
    generationConfig: { maxOutputTokens: IMAGE_ANALYSIS_MAX_OUTPUT_TOKENS },
  });
  const models = options.models.filter((model, index, all) => model && all.indexOf(model) === index);
  const call = beginModelCall("vision", models[0] ?? "", options.modelCallId, "google");
  let lastError: Error | undefined;

  for (const model of models) {
    for (let attempt = 0; ; attempt += 1) {
      if (options.signal?.aborted) throw abortError();
      if (options.trace) options.trace.httpRequests += 1;
      call.httpRequests += 1;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
          body: payload,
          signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
        });
      } catch (error) {
        if (options.signal?.aborted) throw abortError();
        if (isAbortError(error)) {
          const timedOut = timeoutError(label, "google", model);
          call.failure = { code: timedOut.code, model };
          throw timedOut;
        }
        if (!isTransportError(error)) throw error;
        lastError = transportFailure(label, "google", error, model);
        call.failure = { code: "AI_UNAVAILABLE", model };
        const wait = retryDelayMs({ kind: "transient" }, attempt);
        if (wait === null) break;
        await sleep(wait, options.signal);
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (response.ok) {
        const json = await readJsonBody<GeminiVisionResponse>(response, label, "google", model);
        if (json.responseId) options.trace?.responseIds.push(json.responseId);
        const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
        if (text) {
          call.servedModel = model;
          call.outcome = "ok";
          options.trace?.servedModels?.push(model);
          return text;
        }
        // An empty analysis is not a provider outage and not a reason to switch providers.
        lastError = new Error("Gemini returned an empty image analysis");
        break;
      }

      call.status = response.status;
      const details = await response.text().catch(() => "");
      const failure: ProviderFailure = classifyGeminiFailure(response.status, details, response.headers.get("retry-after"));
      const providerError: AIProviderError = toProviderError(label, response.status, response.statusText, failure, details, model);
      providerError.provider = "google";
      lastError = providerError;
      call.failure = { code: providerError.code, quotaType: providerError.quotaType, ...providerError.evidence };
      if (failure.kind === "fatal") throw lastError;
      const wait = retryDelayMs(failure, attempt);
      if (wait === null) {
        if (!shouldTryNextModel(failure)) throw lastError;
        break;
      }
      await sleep(wait, options.signal);
    }
  }
  throw lastError ?? new Error("Gemini image analysis failed");
}
