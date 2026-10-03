import { AIProviderError } from "./geminiErrors.js";

/**
 * Failures that happen below HTTP: a request that timed out, a connection that was refused or
 * reset, a body that ended early. Every provider adapter classifies them the same way, so a
 * timeout is a structured, retryable `AIProviderError` (AI_PROVIDER_TIMEOUT) instead of a bare
 * `Error` that the API could only report as an internal failure.
 *
 * Only errors that really come from the network are classified. A bug in this application (a
 * `TypeError` from our own code) is deliberately NOT turned into a "provider unavailable": that
 * would route it to a fallback provider and hide it.
 */

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_ABORTED",
]);

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function codeOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** True for what Node's fetch (undici) throws when the network, not the server, failed. */
export function isTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message === "fetch failed" || error.message === "terminated") return true;
  if (codeOf(error) && NETWORK_CODES.has(codeOf(error)!)) return true;
  const causeCode = codeOf((error as { cause?: unknown }).cause);
  return causeCode !== undefined && NETWORK_CODES.has(causeCode);
}

/** A short, safe description of a transport failure (an errno name, never a message body). */
export function transportReason(error: unknown): string {
  const direct = codeOf(error);
  if (direct) return direct;
  const cause = codeOf(error instanceof Error ? (error as { cause?: unknown }).cause : undefined);
  return cause ?? "network error";
}

/** The request outlived its time budget. The provider may still be working: never retried blindly. */
export function timeoutError(label: string, provider: string, model?: string): AIProviderError {
  return new AIProviderError(`${label} timed out`, "AI_UNAVAILABLE", 0, true, undefined, undefined, { model }, {
    kind: "AI_PROVIDER_TIMEOUT",
    provider,
  });
}

/** The request never produced a response (or the response body was cut off). */
export function transportFailure(label: string, provider: string, cause: unknown, model?: string): AIProviderError {
  return new AIProviderError(`${label} failed: ${transportReason(cause)}`, "AI_UNAVAILABLE", 0, true, undefined, undefined, { model }, {
    kind: "AI_PROVIDER_UNAVAILABLE",
    provider,
  });
}

/** The provider answered 2xx with a body that is not usable JSON. */
export function unreadableResponse(label: string, provider: string, model?: string): AIProviderError {
  return new AIProviderError(`${label} returned an unreadable response`, "AI_UNAVAILABLE", 502, true, undefined, undefined, { model }, {
    kind: "AI_PROVIDER_UNAVAILABLE",
    provider,
  });
}

/** Reads a 2xx JSON body, reporting a truncated or malformed one as a provider failure. */
export async function readJsonBody<T>(res: Response, label: string, provider: string, model?: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw isTransportError(error) ? transportFailure(label, provider, error, model) : unreadableResponse(label, provider, model);
  }
}
