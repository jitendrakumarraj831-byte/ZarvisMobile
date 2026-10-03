import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AIProviderError,
  classifyGeminiFailure,
  providerErrorPayload,
  retryDelayMs,
  shouldTryNextModel,
} from "../../src/ai/geminiErrors.js";
import { GeminiProvider } from "../../src/ai/geminiProvider.js";
import type { AIRequest } from "../../src/ai/provider.js";

import { DAILY, PER_MINUTE, quotaBody } from "./geminiFixtures.js";


const request: AIRequest = {
  systemPrompt: "You are ZARVIS.",
  messages: [{ role: "user", content: "kal ka weather" }],
  modelConfig: { provider: "google", model: "gemini-3.6-flash" },
};

afterEach(() => vi.unstubAllGlobals());

describe("classifyGeminiFailure", () => {
  it("recognises an exhausted daily quota and its advertised retry delay", () => {
    expect(classifyGeminiFailure(429, quotaBody(DAILY), null)).toEqual({
      kind: "quota",
      quotaType: "daily",
      retryAfterMs: 21_000,
      quotaId: DAILY,
      quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
    });
  });

  it("names the violation that decided the type when several are listed", () => {
    const body = JSON.parse(quotaBody(DAILY));
    body.error.details[0].violations.unshift({ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_input_token_count", quotaId: PER_MINUTE });
    expect(classifyGeminiFailure(429, JSON.stringify(body), null)).toMatchObject({ quotaType: "daily", quotaId: DAILY });
  });

  it("recognises a per-minute rate limit", () => {
    expect(classifyGeminiFailure(429, quotaBody(PER_MINUTE, "3s"), null)).toMatchObject({ kind: "quota", quotaType: "per_minute", retryAfterMs: 3000 });
  });

  it("treats a 429 without details as an unknown quota and uses Retry-After", () => {
    expect(classifyGeminiFailure(429, "Too Many Requests", "2")).toEqual({ kind: "quota", quotaType: "unknown", retryAfterMs: 2000, quotaId: undefined });
  });

  it("separates transient, missing-model and permanent failures", () => {
    expect(classifyGeminiFailure(503, "", null)).toEqual({ kind: "transient", retryAfterMs: undefined });
    expect(classifyGeminiFailure(404, "", null)).toEqual({ kind: "not_found" });
    expect(classifyGeminiFailure(400, "", null)).toEqual({ kind: "fatal" });
  });
});

describe("retry policy", () => {
  const noJitter = () => 0;

  it("never retries a daily quota and never moves it to another model", () => {
    const failure = classifyGeminiFailure(429, quotaBody(DAILY, "1s"), null);
    expect(retryDelayMs(failure, 0, noJitter)).toBeNull();
    expect(shouldTryNextModel(failure)).toBe(false);
  });

  it("retries a short per-minute limit once, honouring RetryInfo", () => {
    const failure = classifyGeminiFailure(429, quotaBody(PER_MINUTE, "3s"), null);
    expect(retryDelayMs(failure, 0, noJitter)).toBe(3000);
    expect(retryDelayMs(failure, 1, noJitter)).toBeNull();
  });

  it("does not wait inside a request for a long advertised delay", () => {
    const failure = classifyGeminiFailure(429, quotaBody(PER_MINUTE, "45s"), null);
    expect(retryDelayMs(failure, 0, noJitter)).toBeNull();
  });

  it("backs off transient failures exponentially, at most twice, with jitter", () => {
    const failure = { kind: "transient" } as const;
    expect(retryDelayMs(failure, 0, noJitter)).toBe(1000);
    expect(retryDelayMs(failure, 1, noJitter)).toBe(2000);
    expect(retryDelayMs(failure, 2, noJitter)).toBeNull();
    expect(retryDelayMs(failure, 0, () => 0.5)).toBe(1200);
  });
});

describe("GeminiProvider quota handling", () => {
  it("sends exactly ONE request for a daily-quota 429 and fails with AI_QUOTA_EXCEEDED", async () => {
    const fetchMock = vi.fn(async () => new Response(quotaBody(DAILY), { status: 429, statusText: "Too Many Requests" }));
    vi.stubGlobal("fetch", fetchMock);
    const trace = { httpRequests: 0, responseIds: [] as string[] };

    const error = await new GeminiProvider("k").generate({ ...request, trace }).catch((e) => e);

    expect(error).toBeInstanceOf(AIProviderError);
    expect(error).toMatchObject({ code: "AI_QUOTA_EXCEEDED", retryable: false, quotaType: "daily", status: 429 });
    // Keeps the prefix the server's error mapping and logs rely on.
    expect(error.message).toMatch(/^Gemini generateContent failed: 429/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(trace.httpRequests).toBe(1);
  });

  it("streams: a daily quota is not retried or moved to the fallback model either", async () => {
    const fetchMock = vi.fn(async () => new Response(quotaBody(DAILY), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const consume = async () => {
      for await (const _chunk of new GeminiProvider("k").streamGenerate(request)) {
        // no chunks expected
      }
    };
    await expect(consume()).rejects.toMatchObject({ code: "AI_QUOTA_EXCEEDED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a short per-minute limit once and then succeeds", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response(quotaBody(PER_MINUTE, "0.05s"), { status: 429 });
      return new Response(JSON.stringify({ responseId: "resp-1", candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 });
    }));
    const trace = { httpRequests: 0, responseIds: [] as string[] };

    const response = await new GeminiProvider("k").generate({ ...request, trace });

    expect(response.message.content).toBe("ok");
    expect(calls).toBe(2);
    expect(trace).toEqual({ httpRequests: 2, responseIds: ["resp-1"] });
  });

  it("gives up on a per-minute limit with a long advertised wait, as retryable AI_RATE_LIMITED", async () => {
    const fetchMock = vi.fn(async () => new Response(quotaBody(PER_MINUTE, "40s"), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await new GeminiProvider("k").generate(request).catch((e) => e);

    expect(error).toMatchObject({ code: "AI_RATE_LIMITED", retryable: true, retryAfterMs: 40_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(providerErrorPayload(error)).toEqual({
      type: "AI_RATE_LIMITED",
      code: "AI_RATE_LIMITED",
      error: expect.stringContaining("about 40 seconds"),
      retryable: true,
      retryAfterMs: 40_000,
      quotaType: "per_minute",
    });
  });

  it("stops without another request once the turn is cancelled", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      controller.abort();
      return new Response("busy", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const error = await new GeminiProvider("k").generate({ ...request, signal: controller.signal }).catch((e) => e);

    expect(error.name).toBe("AbortError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
