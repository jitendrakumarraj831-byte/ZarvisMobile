import { AIProviderError, type ProviderFailure, type QuotaType } from "./geminiErrors.js";
import type { AIErrorKind } from "./errorTaxonomy.js";
import { redactString } from "../security/redact.js";

/**
 * Failure classification for OpenRouter's OpenAI-compatible API, feeding the SAME retry policy as
 * Gemini (`retryDelayMs` in ai/geminiErrors.ts): a daily quota or an empty credit balance is never
 * retried, a short rate limit is retried once, a transient 5xx at most twice.
 *
 * OpenRouter reports errors as `{"error": {"code", "message", "metadata"}}`. Rate-limit answers
 * name the window in the message (`free-models-per-day`, `free-models-per-min`) and may carry
 * `X-RateLimit-Reset` (epoch milliseconds) under `metadata.headers`. An upstream provider's own
 * 429 arrives with the same status but no window; that is treated as a rate limit of unknown size.
 *
 * The provider's `metadata.raw` (an upstream body that can echo request text) is never copied into
 * an error message.
 */
interface OpenRouterErrorBody {
  error?: {
    code?: number | string;
    message?: unknown;
    metadata?: {
      headers?: Record<string, unknown>;
      raw?: unknown;
      reasons?: unknown;
      flagged_input?: unknown;
    };
  };
}

export interface OpenRouterErrorInfo {
  message: string;
  headers: Record<string, string>;
  /** A moderation refusal of the request content (a 403 that is not about credentials). */
  moderation: boolean;
  /** Text used to recognise the rate-limit window; never logged or returned. */
  hintText: string;
}

const MAX_DETAIL_CHARS = 200;

export function parseOpenRouterError(bodyText: string): OpenRouterErrorInfo {
  let parsed: OpenRouterErrorBody | undefined;
  try {
    parsed = JSON.parse(bodyText) as OpenRouterErrorBody;
  } catch {
    parsed = undefined;
  }
  const error = parsed?.error;
  const message = typeof error?.message === "string" ? error.message : "";
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(error?.metadata?.headers ?? {})) {
    if (typeof value === "string" || typeof value === "number") headers[name.toLowerCase()] = String(value);
  }
  const raw = typeof error?.metadata?.raw === "string" ? error.metadata.raw.slice(0, 500) : "";
  const moderation = Boolean(error?.metadata?.reasons ?? error?.metadata?.flagged_input) || /moderation|flagged/i.test(message);
  return { message, headers, moderation, hintText: `${message} ${raw}`.toLowerCase() };
}

function parseRetryAfter(header: string | null | undefined): number | undefined {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

/** `X-RateLimit-Reset` is epoch milliseconds (seconds are accepted too); returns the wait from `now`. */
function waitUntilReset(value: string | undefined, now: number): number | undefined {
  if (!value) return undefined;
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  const resetAt = raw < 1e12 ? raw * 1000 : raw;
  const wait = resetAt - now;
  return wait > 0 && wait <= 24 * 60 * 60 * 1000 ? wait : undefined;
}

const TRANSIENT_STATUSES = new Set([408, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529]);

export function classifyOpenRouterFailure(
  status: number,
  bodyText: string,
  retryAfterHeader?: string | null,
  now: number = Date.now(),
): ProviderFailure {
  const info = parseOpenRouterError(bodyText);
  const retryAfterMs = parseRetryAfter(retryAfterHeader);
  if (status === 404) return { kind: "not_found" };
  // An empty (or negative) credit balance blocks even free models. Nothing in this request fixes it.
  if (status === 402) return { kind: "quota", quotaType: "credits" };
  if (TRANSIENT_STATUSES.has(status)) return { kind: "transient", retryAfterMs };
  if (status !== 429) return { kind: "fatal" };

  const quotaType: QuotaType = /per[- ]?day|daily/.test(info.hintText) ? "daily" : /per[- ]?min/.test(info.hintText) ? "per_minute" : "unknown";
  const window = /rate limit exceeded:\s*([\w-]+)/i.exec(info.message)?.[1];
  return {
    kind: "quota",
    quotaType,
    // The reset time of a daily window is hours away: it must never be waited for inside a request.
    retryAfterMs: quotaType === "daily" ? undefined : (retryAfterMs ?? waitUntilReset(info.headers["x-ratelimit-reset"], now)),
    quotaId: window,
  };
}

function kindForOpenRouterStatus(status: number, failure: ProviderFailure, info: OpenRouterErrorInfo): AIErrorKind {
  if (failure.kind === "quota") return failure.quotaType === "daily" || failure.quotaType === "credits" ? "AI_PROVIDER_QUOTA_EXCEEDED" : "AI_PROVIDER_RATE_LIMIT";
  if (status === 401) return "AI_PROVIDER_AUTH_ERROR";
  if (status === 403) return info.moderation ? "AI_PROVIDER_INVALID_REQUEST" : "AI_PROVIDER_AUTH_ERROR";
  // "No endpoints found (that support tool use / image input)": the routed model cannot serve this
  // request, or no longer exists. A configuration problem, not an outage.
  if (status === 404) return "AI_PROVIDER_CAPABILITY_UNSUPPORTED";
  if (status === 408 || status === 504) return "AI_PROVIDER_TIMEOUT";
  if (status === 400 || status === 413 || status === 422) return "AI_PROVIDER_INVALID_REQUEST";
  return "AI_PROVIDER_UNAVAILABLE";
}

/** The structured error for a final failure. The message carries a bounded, secret-scrubbed detail. */
export function toOpenRouterError(
  label: string,
  status: number,
  statusText: string,
  failure: ProviderFailure,
  bodyText: string,
  model?: string,
): AIProviderError {
  const info = parseOpenRouterError(bodyText);
  const detail = redactString(info.message).replace(/\s+/g, " ").slice(0, MAX_DETAIL_CHARS);
  const message = `${label} failed: ${status} ${statusText} ${detail}`.trim();
  const kind = kindForOpenRouterStatus(status, failure, info);
  const options = { kind, provider: "openrouter" };

  if (failure.kind === "quota") {
    const evidence = { model, quotaId: failure.quotaId };
    return failure.quotaType === "daily" || failure.quotaType === "credits"
      ? new AIProviderError(message, "AI_QUOTA_EXCEEDED", status, false, failure.retryAfterMs, failure.quotaType, evidence, options)
      : new AIProviderError(message, "AI_RATE_LIMITED", status, true, failure.retryAfterMs, failure.quotaType, evidence, options);
  }
  return new AIProviderError(
    message,
    "AI_UNAVAILABLE",
    status,
    failure.kind === "transient",
    failure.kind === "transient" ? failure.retryAfterMs : undefined,
    undefined,
    { model },
    options,
  );
}

/**
 * An error OpenRouter reports inside an HTTP 200 body (a mid-stream failure, or a response whose
 * choice ended in `finish_reason: "error"`). The numeric `code` is the status the failure would
 * have had.
 */
export function openRouterBodyError(label: string, errorObject: unknown, model?: string): AIProviderError {
  const raw = errorObject && typeof errorObject === "object" ? (errorObject as { code?: unknown }) : {};
  const code = Number(raw.code);
  const status = Number.isInteger(code) && code >= 400 && code <= 599 ? code : 502;
  const body = JSON.stringify({ error: errorObject });
  const failure = classifyOpenRouterFailure(status, body);
  return toOpenRouterError(label, status, "", failure, body, model);
}
