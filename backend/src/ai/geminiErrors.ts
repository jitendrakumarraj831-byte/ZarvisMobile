/**
 * One failure classification and retry policy for every Gemini call (chat generation, web
 * search grounding, TTS, image analysis).
 *
 * The rule that matters most: a 429 is not always "try again in a moment". Gemini returns
 * RESOURCE_EXHAUSTED both for a short per-minute rate window and for an exhausted daily /
 * project quota (e.g. `generate_content_free_tier_requests`, quota id `...PerDay...`).
 * Retrying the second kind can never succeed today; it only spends more requests and keeps
 * the user waiting. So a daily quota fails immediately with a structured error, a per-minute
 * limit is retried once only when the server-advised wait is short, and transient 5xx/408
 * errors get a small bounded backoff.
 */

export type AIErrorCode = "AI_QUOTA_EXCEEDED" | "AI_RATE_LIMITED" | "AI_UNAVAILABLE";
export type QuotaType = "daily" | "per_minute" | "unknown";

/** What the provider itself said, kept for the server log so a failure's cause can be proven
 * (which quota, which model). Never sent to the client and never contains the API key. */
export interface ProviderFailureEvidence {
  model?: string;
  quotaId?: string;
  quotaMetric?: string;
}

/** A provider failure the API can report to the user as a structured, honest error. */
export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly code: AIErrorCode,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
    readonly quotaType?: QuotaType,
    readonly evidence: ProviderFailureEvidence = {},
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

export type GeminiFailure =
  | { kind: "quota"; quotaType: QuotaType; retryAfterMs?: number; quotaId?: string; quotaMetric?: string }
  | { kind: "transient"; retryAfterMs?: number }
  | { kind: "not_found" }
  | { kind: "fatal" };

const TRANSIENT_STATUSES = new Set([408, 500, 502, 503, 504]);

/** Longest server-advised wait we will spend inside one user request before giving up. */
export const MAX_IN_REQUEST_WAIT_MS = 8_000;

interface GoogleErrorDetail {
  "@type"?: string;
  retryDelay?: string;
  violations?: Array<{ quotaId?: string; quotaMetric?: string }>;
}

/** Classifies a non-OK Gemini HTTP response from its status, body and Retry-After header. */
export function classifyGeminiFailure(status: number, bodyText: string, retryAfterHeader?: string | null): GeminiFailure {
  const headerMs = parseRetryAfterHeader(retryAfterHeader);
  if (status === 404) return { kind: "not_found" };
  if (TRANSIENT_STATUSES.has(status)) return { kind: "transient", retryAfterMs: headerMs };
  if (status !== 429) return { kind: "fatal" };

  let details: GoogleErrorDetail[] = [];
  try {
    const parsed = JSON.parse(bodyText) as { error?: { details?: GoogleErrorDetail[] } };
    details = Array.isArray(parsed?.error?.details) ? parsed.error.details : [];
  } catch {
    // Not JSON: fall through with no details.
  }
  const violations = details.flatMap((detail) => detail.violations ?? []);
  const quotaText = violations.map((v) => `${v.quotaId ?? ""} ${v.quotaMetric ?? ""}`).join(" ").toLowerCase();
  const retryInfo = details.find((detail) => detail["@type"]?.endsWith("google.rpc.RetryInfo"));
  const retryAfterMs = parseDuration(retryInfo?.retryDelay) ?? headerMs;
  const quotaType: QuotaType = /per ?day|perday|daily/.test(quotaText)
    ? "daily"
    : /per ?minute|perminute/.test(quotaText)
      ? "per_minute"
      : "unknown";
  // The violation that decided the type is the one reported (a daily one wins over others).
  const decisive = violations.find((v) => {
    const text = `${v.quotaId ?? ""} ${v.quotaMetric ?? ""}`.toLowerCase();
    return quotaType === "daily" ? /per ?day|perday|daily/.test(text) : quotaType === "per_minute" ? /per ?minute|perminute/.test(text) : true;
  }) ?? violations[0];
  return { kind: "quota", quotaType, retryAfterMs, quotaId: decisive?.quotaId, quotaMetric: decisive?.quotaMetric };
}

/**
 * How long to wait before retrying the SAME model, or `null` to stop retrying it.
 * `attempt` is the zero-based number of the attempt that just failed.
 */
export function retryDelayMs(failure: GeminiFailure, attempt: number, random: () => number = Math.random): number | null {
  const jitter = Math.floor(random() * 400);
  if (failure.kind === "transient") {
    if (attempt >= 2) return null;
    const base = failure.retryAfterMs ?? 1000 * 2 ** attempt;
    return base > MAX_IN_REQUEST_WAIT_MS ? null : base + jitter;
  }
  if (failure.kind === "quota") {
    // A daily/project quota cannot recover within this request: never retry it.
    if (failure.quotaType === "daily" || attempt >= 1) return null;
    const base = failure.retryAfterMs ?? 2000;
    return base > MAX_IN_REQUEST_WAIT_MS ? null : base + jitter;
  }
  return null;
}

/** Whether trying a different model is worthwhile. A quota error is never "fixed" by spending
 * another request on another model in the same request. */
export function shouldTryNextModel(failure: GeminiFailure): boolean {
  return failure.kind === "not_found" || failure.kind === "transient";
}

/** The structured error for a final failure. `label` keeps the existing log/error prefix. */
export function toProviderError(label: string, status: number, statusText: string, failure: GeminiFailure, bodyText: string, model?: string): AIProviderError {
  const message = `${label} failed: ${status} ${statusText} ${bodyText.slice(0, 300)}`.trim();
  if (failure.kind === "quota") {
    const evidence = { model, quotaId: failure.quotaId, quotaMetric: failure.quotaMetric };
    return failure.quotaType === "daily"
      ? new AIProviderError(message, "AI_QUOTA_EXCEEDED", status, false, failure.retryAfterMs, "daily", evidence)
      : new AIProviderError(message, "AI_RATE_LIMITED", status, true, failure.retryAfterMs, failure.quotaType, evidence);
  }
  return new AIProviderError(message, "AI_UNAVAILABLE", status, failure.kind === "transient", failure.kind === "transient" ? failure.retryAfterMs : undefined, undefined, { model });
}

/** Log fields that prove what stopped a request. Safe to log: no key, no provider body. */
export function providerErrorLogFields(error: AIProviderError) {
  return {
    code: error.code,
    status: error.status,
    retryAfterMs: error.retryAfterMs,
    quotaType: error.quotaType,
    quotaId: error.evidence.quotaId,
    quotaMetric: error.evidence.quotaMetric,
    model: error.evidence.model,
  };
}

/** User-facing text for a provider error. Never includes provider bodies or keys. */
export function providerErrorUserMessage(error: AIProviderError): string {
  if (error.code === "AI_QUOTA_EXCEEDED") {
    return "ZARVIS has reached its AI usage limit for today, so this request was not completed. Nothing was charged. Please try again later.";
  }
  if (error.code === "AI_RATE_LIMITED") {
    const seconds = error.retryAfterMs ? Math.max(1, Math.ceil(error.retryAfterMs / 1000)) : undefined;
    return `ZARVIS is receiving too many requests right now${seconds ? ` — please try again in about ${seconds} seconds` : " — please try again shortly"}. Nothing was charged.`;
  }
  return "The AI service is temporarily unavailable, so this request was not completed. Nothing was charged. Please try again.";
}

/** The JSON-safe shape sent to clients. */
export function providerErrorPayload(error: AIProviderError) {
  return {
    type: error.code,
    code: error.code,
    error: providerErrorUserMessage(error),
    retryable: error.retryable,
    ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
    ...(error.quotaType ? { quotaType: error.quotaType } : {}),
  };
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function abortError(): Error {
  const error = new Error("The request was cancelled");
  error.name = "AbortError";
  return error;
}

/** Parses a google.protobuf.Duration string such as "31s" or "1.5s". */
function parseDuration(value: string | undefined): number | undefined {
  const match = value?.match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Math.round(Number(match[1]) * 1000) : undefined;
}

function parseRetryAfterHeader(value: string | null | undefined): number | undefined {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}
