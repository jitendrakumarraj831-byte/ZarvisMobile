import { AIProviderError } from "./geminiErrors.js";

/**
 * The parts of talking to OpenRouter that every caller shares: where the API lives, how a request
 * is addressed and identified, and what an API key may look like. The chat adapter
 * (`openRouterProvider.ts`), the model directory (`openRouterModels.ts`) and web search
 * (`skills/webSearch.ts`) all go through here, so a header, a redirect rule or a key check is
 * written once.
 */
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Optional attribution headers OpenRouter documents (`HTTP-Referer`, `X-Title`); they identify this app, not the user. */
export const OPENROUTER_APP_REFERER = "https://zarvismobile.com";
export const OPENROUTER_APP_TITLE = "ZARVIS";

/**
 * What an API key may contain: visible ASCII, no whitespace. A key pasted with a line break or a quote
 * inside it can never authenticate, and an HTTP client puts the whole header value into its error
 * message, so it is refused before anything is sent.
 */
const API_KEY_PATTERN = /^[\x21-\x7e]{1,512}$/;

export function isUsableApiKey(key: string): boolean {
  return API_KEY_PATTERN.test(key);
}

/** The error for a key that cannot be sent. Says nothing about the key itself. */
export function unusableKeyError(provider: string): AIProviderError {
  return new AIProviderError(
    "The OpenRouter API key contains characters an API key cannot have (whitespace, quotes or a line break); set it again without them",
    "AI_UNAVAILABLE",
    503,
    false,
    undefined,
    undefined,
    {},
    { kind: "AI_PROVIDER_AUTH_ERROR", provider },
  );
}

export function openRouterUrl(baseUrl: string | undefined, path: string): string {
  return `${(baseUrl ?? DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function openRouterHeaders(apiKey: string | undefined, extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    "http-referer": OPENROUTER_APP_REFERER,
    "x-title": OPENROUTER_APP_TITLE,
    ...extra,
  };
}

/**
 * Every OpenRouter request refuses redirects. The API key travels in a header, and a redirect would
 * send it wherever the answer points; OpenRouter's API does not redirect.
 */
export const NO_REDIRECTS: Pick<RequestInit, "redirect"> = { redirect: "error" };
