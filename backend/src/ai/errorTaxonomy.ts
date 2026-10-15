/**
 * The one classification of AI failures, independent of which provider produced them.
 *
 * Two vocabularies exist on purpose:
 *
 * - `AIErrorKind` is the structured, internal classification. It decides retry and fallback and
 *   is what the server log records.
 * - `AIErrorCode` is the wire code. Both clients and several tests already depend on exactly
 *   these three strings (web `logic.js` `turnFailureKind`, Android `AiServiceErrors.kt`), so
 *   they are unchanged. A client never sees the finer kind: an invalid provider key or an
 *   internal bug must not be told apart from "temporarily unavailable" by an anonymous caller.
 *
 * No imports: this file is the leaf every other AI module may depend on.
 */

export const AI_ERROR_KINDS = [
  "AI_PROVIDER_AUTH_ERROR",
  "AI_PROVIDER_RATE_LIMIT",
  "AI_PROVIDER_QUOTA_EXCEEDED",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_PROVIDER_TIMEOUT",
  "AI_PROVIDER_INVALID_REQUEST",
  "AI_PROVIDER_CAPABILITY_UNSUPPORTED",
  "AI_INTERNAL_ERROR",
] as const;

export type AIErrorKind = (typeof AI_ERROR_KINDS)[number];

/** The codes sent to clients. See the note above before adding one. */
export type AIErrorCode = "AI_QUOTA_EXCEEDED" | "AI_RATE_LIMITED" | "AI_UNAVAILABLE";

const WIRE_CODE: Record<AIErrorKind, AIErrorCode> = {
  AI_PROVIDER_QUOTA_EXCEEDED: "AI_QUOTA_EXCEEDED",
  AI_PROVIDER_RATE_LIMIT: "AI_RATE_LIMITED",
  AI_PROVIDER_AUTH_ERROR: "AI_UNAVAILABLE",
  AI_PROVIDER_UNAVAILABLE: "AI_UNAVAILABLE",
  AI_PROVIDER_TIMEOUT: "AI_UNAVAILABLE",
  AI_PROVIDER_INVALID_REQUEST: "AI_UNAVAILABLE",
  AI_PROVIDER_CAPABILITY_UNSUPPORTED: "AI_UNAVAILABLE",
  AI_INTERNAL_ERROR: "AI_UNAVAILABLE",
};

export function wireCodeForKind(kind: AIErrorKind): AIErrorCode {
  return WIRE_CODE[kind];
}

/**
 * Provider-side, temporary conditions: another provider may still be able to answer.
 *
 * Deliberately NOT eligible:
 * - AUTH_ERROR: a rejected key is an operator problem; answering from another provider would
 *   hide it.
 * - INVALID_REQUEST: the request itself is wrong (or the content was refused); another provider
 *   would fail the same way, or worse, accept something this one correctly refused.
 * - CAPABILITY_UNSUPPORTED: raised by routing, not by a provider outage.
 * - INTERNAL_ERROR: a bug in this application must surface, not be papered over.
 */
const FALLBACK_ELIGIBLE: ReadonlySet<AIErrorKind> = new Set<AIErrorKind>([
  "AI_PROVIDER_RATE_LIMIT",
  "AI_PROVIDER_QUOTA_EXCEEDED",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_PROVIDER_TIMEOUT",
]);

export function isFallbackEligibleKind(kind: AIErrorKind): boolean {
  return FALLBACK_ELIGIBLE.has(kind);
}

/** The kind implied by an HTTP status alone (a 429 is refined by the caller into quota or rate limit). */
export function kindForHttpStatus(status: number): AIErrorKind {
  if (status === 401 || status === 403) return "AI_PROVIDER_AUTH_ERROR";
  // The model (or the feature asked of it) does not exist for this account: a configuration
  // problem, not an outage, so it is not a reason to answer from another provider.
  if (status === 404) return "AI_PROVIDER_CAPABILITY_UNSUPPORTED";
  if (status === 408 || status === 504) return "AI_PROVIDER_TIMEOUT";
  if (status === 400 || status === 413 || status === 422) return "AI_PROVIDER_INVALID_REQUEST";
  if (status === 429) return "AI_PROVIDER_RATE_LIMIT";
  return "AI_PROVIDER_UNAVAILABLE";
}

/** The kind of an error built the pre-gateway way, from its wire code and status. */
export function defaultKindFor(code: AIErrorCode, status: number): AIErrorKind {
  if (code === "AI_QUOTA_EXCEEDED") return "AI_PROVIDER_QUOTA_EXCEEDED";
  if (code === "AI_RATE_LIMITED") return "AI_PROVIDER_RATE_LIMIT";
  return kindForHttpStatus(status);
}

/** One provider attempt inside a logical call. Log-only; never sent to a client. */
export interface AttemptSummary {
  provider: string;
  model?: string;
  kind: AIErrorKind;
  status?: number;
}

/** Why a request moved from one provider to another. Closed set, so a log query can group on it. */
export type FallbackReasonCode =
  | `${string}_QUOTA_EXCEEDED`
  | `${string}_RATE_LIMITED`
  | `${string}_UNAVAILABLE`
  | `${string}_TIMEOUT`
  | `${string}_QUOTA_COOLDOWN`
  | `${string}_CAPABILITY_UNSUPPORTED`;

/** `label` is the upper-case provider label, e.g. GEMINI or OPENROUTER. */
export function fallbackReasonFor(label: string, kind: AIErrorKind): FallbackReasonCode {
  switch (kind) {
    case "AI_PROVIDER_QUOTA_EXCEEDED":
      return `${label}_QUOTA_EXCEEDED`;
    case "AI_PROVIDER_RATE_LIMIT":
      return `${label}_RATE_LIMITED`;
    case "AI_PROVIDER_TIMEOUT":
      return `${label}_TIMEOUT`;
    case "AI_PROVIDER_CAPABILITY_UNSUPPORTED":
      return `${label}_CAPABILITY_UNSUPPORTED`;
    default:
      return `${label}_UNAVAILABLE`;
  }
}

/** A provider skipped because its quota was reported spent a moment ago (see ModelGateway). */
export function cooldownReasonFor(label: string): FallbackReasonCode {
  return `${label}_QUOTA_COOLDOWN`;
}
