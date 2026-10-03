import { describe, expect, it } from "vitest";
import {
  AI_ERROR_KINDS,
  cooldownReasonFor,
  defaultKindFor,
  fallbackReasonFor,
  isFallbackEligibleKind,
  kindForHttpStatus,
  wireCodeForKind,
} from "../../src/ai/errorTaxonomy.js";
import { AIProviderError, providerErrorPayload, providerErrorUserMessage } from "../../src/ai/geminiErrors.js";
import { classifyOpenRouterFailure, toOpenRouterError } from "../../src/ai/openRouterErrors.js";
import { retryDelayMs } from "../../src/ai/geminiErrors.js";

describe("the structured error kinds", () => {
  it("defines exactly the documented set", () => {
    expect([...AI_ERROR_KINDS]).toEqual([
      "AI_PROVIDER_AUTH_ERROR",
      "AI_PROVIDER_RATE_LIMIT",
      "AI_PROVIDER_QUOTA_EXCEEDED",
      "AI_PROVIDER_UNAVAILABLE",
      "AI_PROVIDER_TIMEOUT",
      "AI_PROVIDER_INVALID_REQUEST",
      "AI_PROVIDER_CAPABILITY_UNSUPPORTED",
      "AI_INTERNAL_ERROR",
    ]);
  });

  it("maps every kind onto the three wire codes the web and Android clients already understand", () => {
    expect(Object.fromEntries(AI_ERROR_KINDS.map((kind) => [kind, wireCodeForKind(kind)]))).toEqual({
      AI_PROVIDER_AUTH_ERROR: "AI_UNAVAILABLE",
      AI_PROVIDER_RATE_LIMIT: "AI_RATE_LIMITED",
      AI_PROVIDER_QUOTA_EXCEEDED: "AI_QUOTA_EXCEEDED",
      AI_PROVIDER_UNAVAILABLE: "AI_UNAVAILABLE",
      AI_PROVIDER_TIMEOUT: "AI_UNAVAILABLE",
      AI_PROVIDER_INVALID_REQUEST: "AI_UNAVAILABLE",
      AI_PROVIDER_CAPABILITY_UNSUPPORTED: "AI_UNAVAILABLE",
      AI_INTERNAL_ERROR: "AI_UNAVAILABLE",
    });
  });

  it("allows a fallback only for temporary provider-side conditions", () => {
    const eligible = AI_ERROR_KINDS.filter((kind) => isFallbackEligibleKind(kind));
    expect(eligible).toEqual(["AI_PROVIDER_RATE_LIMIT", "AI_PROVIDER_QUOTA_EXCEEDED", "AI_PROVIDER_UNAVAILABLE", "AI_PROVIDER_TIMEOUT"]);
  });

  it.each([
    [401, "AI_PROVIDER_AUTH_ERROR"],
    [403, "AI_PROVIDER_AUTH_ERROR"],
    [404, "AI_PROVIDER_CAPABILITY_UNSUPPORTED"],
    [408, "AI_PROVIDER_TIMEOUT"],
    [400, "AI_PROVIDER_INVALID_REQUEST"],
    [413, "AI_PROVIDER_INVALID_REQUEST"],
    [422, "AI_PROVIDER_INVALID_REQUEST"],
    [429, "AI_PROVIDER_RATE_LIMIT"],
    [500, "AI_PROVIDER_UNAVAILABLE"],
    [503, "AI_PROVIDER_UNAVAILABLE"],
  ])("HTTP %i is %s", (status, kind) => {
    expect(kindForHttpStatus(status)).toBe(kind);
  });

  it("an error built the pre-gateway way (code + status) still gets the right kind", () => {
    expect(new AIProviderError("m", "AI_QUOTA_EXCEEDED", 429, false).kind).toBe("AI_PROVIDER_QUOTA_EXCEEDED");
    expect(new AIProviderError("m", "AI_RATE_LIMITED", 429, true).kind).toBe("AI_PROVIDER_RATE_LIMIT");
    expect(new AIProviderError("m", "AI_UNAVAILABLE", 503, true).kind).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(new AIProviderError("m", "AI_UNAVAILABLE", 403, false).kind).toBe("AI_PROVIDER_AUTH_ERROR");
    expect(defaultKindFor("AI_UNAVAILABLE", 0)).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(new AIProviderError("m", "AI_UNAVAILABLE", 0, true, undefined, undefined, {}, { kind: "AI_PROVIDER_TIMEOUT", provider: "google" })).toMatchObject({ kind: "AI_PROVIDER_TIMEOUT", provider: "google" });
  });

  it("names the fallback reason as <PROVIDER>_<CONDITION>, a closed set a log query can group on", () => {
    expect(fallbackReasonFor("GEMINI", "AI_PROVIDER_QUOTA_EXCEEDED")).toBe("GEMINI_QUOTA_EXCEEDED");
    expect(fallbackReasonFor("GEMINI", "AI_PROVIDER_RATE_LIMIT")).toBe("GEMINI_RATE_LIMITED");
    expect(fallbackReasonFor("GEMINI", "AI_PROVIDER_UNAVAILABLE")).toBe("GEMINI_UNAVAILABLE");
    expect(fallbackReasonFor("OPENROUTER", "AI_PROVIDER_TIMEOUT")).toBe("OPENROUTER_TIMEOUT");
    expect(fallbackReasonFor("GEMINI", "AI_PROVIDER_CAPABILITY_UNSUPPORTED")).toBe("GEMINI_CAPABILITY_UNSUPPORTED");
    expect(cooldownReasonFor("GEMINI")).toBe("GEMINI_QUOTA_COOLDOWN");
  });
});

describe("what a client is told", () => {
  it("keeps the existing wire payload shape exactly: no kind, provider or attempt detail", () => {
    const error = new AIProviderError("Gemini generateContent failed: 429 secret-body", "AI_QUOTA_EXCEEDED", 429, false, 21_000, "daily");
    error.provider = "google";
    error.attempts = [{ provider: "google", kind: "AI_PROVIDER_QUOTA_EXCEEDED" }];
    expect(providerErrorPayload(error)).toEqual({
      type: "AI_QUOTA_EXCEEDED",
      code: "AI_QUOTA_EXCEEDED",
      error: "ZARVIS has reached its AI usage limit for today, so this request was not completed. Nothing was charged. Please try again later.",
      retryable: false,
      retryAfterMs: 21_000,
      quotaType: "daily",
    });
  });

  it("does not say 'today' for a spent credit balance, and names a capability gap honestly", () => {
    const credits = new AIProviderError("m", "AI_QUOTA_EXCEEDED", 402, false, undefined, "credits");
    expect(providerErrorUserMessage(credits)).toContain("current AI usage limit");
    expect(providerErrorUserMessage(credits)).not.toContain("today");
    const capability = new AIProviderError("m", "AI_UNAVAILABLE", 503, false, undefined, undefined, {}, { kind: "AI_PROVIDER_CAPABILITY_UNSUPPORTED" });
    expect(providerErrorUserMessage(capability)).toContain("capability that is not available");
    expect(providerErrorUserMessage(capability)).toContain("Nothing was charged");
    // The generic message is unchanged.
    expect(providerErrorUserMessage(new AIProviderError("m", "AI_UNAVAILABLE", 503, true))).toMatch(/temporarily unavailable/);
  });
});

describe("OpenRouter failure classification (same retry policy as Gemini)", () => {
  const body = (message: string, extra: Record<string, unknown> = {}) => JSON.stringify({ error: { code: 429, message, ...extra } });

  it("recognises a daily free-model limit and never waits for its reset", () => {
    const failure = classifyOpenRouterFailure(429, body("Rate limit exceeded: free-models-per-day. Add 10 credits", { metadata: { headers: { "X-RateLimit-Reset": String(Date.now() + 3_600_000) } } }));
    expect(failure).toMatchObject({ kind: "quota", quotaType: "daily", retryAfterMs: undefined, quotaId: "free-models-per-day" });
    expect(retryDelayMs(failure, 0, () => 0)).toBeNull();
  });

  it("recognises a per-minute limit, uses the advertised reset, and retries once only when the wait is short", () => {
    const soon = classifyOpenRouterFailure(429, body("Rate limit exceeded: free-models-per-min.", { metadata: { headers: { "X-RateLimit-Reset": String(Date.now() + 3_000) } } }), null, Date.now());
    expect(soon).toMatchObject({ kind: "quota", quotaType: "per_minute" });
    expect(retryDelayMs(soon, 0, () => 0)).toBeGreaterThan(0);
    expect(retryDelayMs(soon, 0, () => 0)!).toBeLessThanOrEqual(3_100);
    expect(retryDelayMs(soon, 1, () => 0)).toBeNull();

    const far = classifyOpenRouterFailure(429, body("Rate limit exceeded: free-models-per-min.", { metadata: { headers: { "X-RateLimit-Reset": String(Date.now() + 45_000) } } }));
    expect(retryDelayMs(far, 0, () => 0)).toBeNull();
  });

  it("prefers Retry-After, and treats an upstream provider's 429 (no window named) as a rate limit of unknown size", () => {
    expect(classifyOpenRouterFailure(429, body("Provider returned error"), "2")).toMatchObject({ quotaType: "unknown", retryAfterMs: 2_000 });
  });

  it("402 is an empty balance: quota, never retried", () => {
    const failure = classifyOpenRouterFailure(402, JSON.stringify({ error: { code: 402, message: "Insufficient credits" } }));
    expect(failure).toEqual({ kind: "quota", quotaType: "credits" });
    expect(retryDelayMs(failure, 0, () => 0)).toBeNull();
  });

  it("separates transient, missing-model and permanent failures", () => {
    for (const status of [408, 500, 502, 503, 504, 529]) expect(classifyOpenRouterFailure(status, "")).toMatchObject({ kind: "transient" });
    expect(classifyOpenRouterFailure(404, "")).toEqual({ kind: "not_found" });
    for (const status of [400, 401, 403, 413, 422]) expect(classifyOpenRouterFailure(status, "")).toEqual({ kind: "fatal" });
  });

  it("builds a bounded, secret-scrubbed message and the right kind; moderation is an invalid request, not an auth failure", () => {
    const moderation = toOpenRouterError("OpenRouter chat completions", 403, "Forbidden", { kind: "fatal" }, JSON.stringify({ error: { code: 403, message: "Input flagged by moderation", metadata: { reasons: ["x"], flagged_input: "private user text" } } }));
    expect(moderation.kind).toBe("AI_PROVIDER_INVALID_REQUEST");
    expect(moderation.message).not.toContain("private user text"); // user content never reaches an error message

    const auth = toOpenRouterError("OpenRouter chat completions", 401, "Unauthorized", { kind: "fatal" }, JSON.stringify({ error: { code: 401, message: `bad key sk-or-v1-${"a".repeat(30)} ${"x".repeat(500)}` } }));
    expect(auth.kind).toBe("AI_PROVIDER_AUTH_ERROR");
    expect(auth.message).not.toMatch(/sk-or-v1-a{10}/);
    expect(auth.message.length).toBeLessThan(300);
    expect(auth).toMatchObject({ provider: "openrouter", retryable: false, code: "AI_UNAVAILABLE" });
  });
});
