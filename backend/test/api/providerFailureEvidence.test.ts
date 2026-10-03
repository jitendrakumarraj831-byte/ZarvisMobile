import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { Orchestrator } from "../../src/agents/orchestrator.js";
import { GeminiProvider } from "../../src/ai/geminiProvider.js";
import { buildContainer } from "../../src/container.js";
import { logger } from "../../src/security/redact.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { DAILY, PER_MINUTE, quotaBody } from "../ai/geminiFixtures.js";

/**
 * A failed turn must leave enough evidence in the server log to prove which provider condition
 * stopped it: the Gemini HTTP status, quota type, quota id and metric, the model that failed,
 * and how many HTTP requests the turn sent. (Production 2026-10-03: the logs showed only
 * "code" and "status", so the quota behind "today's AI usage limit" could not be proven.)
 * The real GeminiProvider runs; only Gemini's HTTP answers are stubbed.
 */
const MODEL = "gemini-3.6-flash";

function appWithGemini() {
  const container = buildContainer(new InMemoryStore());
  const orchestrator = new Orchestrator(container.registry, container.entitlementPort, container.pipeline, new GeminiProvider("test-key"), { provider: "google", model: MODEL }, container.store);
  return buildServer({ ...container, orchestrator, ttsProvider: null });
}

function stubGemini(status: number, body: string) {
  const fetchMock = vi.fn(async () => new Response(body, { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

type Logged = { message: string; data: Record<string, any> };
function captureLogs() {
  const lines: Logged[] = [];
  vi.spyOn(logger, "warn").mockImplementation((message: string, data?: unknown) => { lines.push({ message, data: (data ?? {}) as Record<string, any> }); });
  vi.spyOn(logger, "info").mockImplementation((message: string, data?: unknown) => { lines.push({ message, data: (data ?? {}) as Record<string, any> }); });
  return lines;
}

async function streamTurn(app: ReturnType<typeof buildServer>) {
  const guest = await request(app).post("/api/v1/auth/guest").send({});
  const res = await request(app)
    .post("/api/v1/orchestrator/turn-stream")
    .set("Authorization", `Bearer ${guest.body.accessToken}`)
    .send({ utterance: "write a short poem about the monsoon" });
  const frame = res.text.split("\n\n").find((f) => f.startsWith("event: error"));
  return { status: res.status, error: frame ? JSON.parse(frame.split("data: ")[1]!) : undefined };
}

describe("a provider failure is logged with proof of its cause", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("daily quota: one Gemini request, no retry, and the log names status, quota id, metric and model", async () => {
    const fetchMock = stubGemini(429, quotaBody(DAILY));
    const logs = captureLogs();
    const { status, error } = await streamTurn(appWithGemini());

    // SSE: the HTTP status is 200 because the stream had started; the failure is the error event.
    expect(status).toBe(200);
    expect(error).toMatchObject({ code: "AI_QUOTA_EXCEEDED", quotaType: "daily", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const stopped = logs.find((l) => l.message === "Streaming turn stopped by the AI provider");
    expect(stopped?.data).toMatchObject({
      turnId: error.turnId,
      code: "AI_QUOTA_EXCEEDED",
      status: 429,
      quotaType: "daily",
      quotaId: DAILY,
      quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
      model: MODEL,
    });

    const finished = logs.find((l) => l.message === "Turn finished");
    expect(finished?.data).toMatchObject({ turnId: error.turnId, aiCalls: 1, aiHttpRequests: 1, toolCalls: [] });
    expect(finished?.data.aiCallLog[0]).toMatchObject({
      kind: "planner",
      httpRequests: 1,
      outcome: "error",
      status: 429,
      failure: { code: "AI_QUOTA_EXCEEDED", quotaType: "daily", quotaId: DAILY, model: MODEL },
    });
  });

  it("per-minute limit: reported as AI_RATE_LIMITED, never as today's limit", async () => {
    stubGemini(429, quotaBody(PER_MINUTE, "60s"));
    const logs = captureLogs();
    const { error } = await streamTurn(appWithGemini());
    expect(error).toMatchObject({ code: "AI_RATE_LIMITED", quotaType: "per_minute" });
    expect(error.error).not.toMatch(/today/);
    const stopped = logs.find((l) => l.message === "Streaming turn stopped by the AI provider");
    expect(stopped?.data).toMatchObject({ status: 429, quotaType: "per_minute", quotaId: PER_MINUTE, model: MODEL });
  });

  it("a 503 is AI_UNAVAILABLE with the model logged, never a quota", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"], shouldAdvanceTime: true, advanceTimeDelta: 500 });
    stubGemini(503, JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "overloaded" } }));
    const logs = captureLogs();
    const { error } = await streamTurn(appWithGemini());
    vi.useRealTimers();
    expect(error).toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(error.error).not.toMatch(/today/);
    const stopped = logs.find((l) => l.message === "Streaming turn stopped by the AI provider");
    expect(stopped?.data).toMatchObject({ code: "AI_UNAVAILABLE", status: 503 });
    expect(stopped?.data.quotaType).toBeUndefined();
    expect(typeof stopped?.data.model).toBe("string");
  }, 30_000);
});
