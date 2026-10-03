import type { Express } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { env } from "../../src/config/env.js";
import { buildContainer } from "../../src/container.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { buildServer } from "../../src/server.js";
import { DAILY, quotaBody } from "../ai/geminiFixtures.js";

// The retry policy's waits are covered in geminiErrors.test.ts; here they only slow the test.
vi.mock("../../src/ai/geminiErrors.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/ai/geminiErrors.js")>()),
  sleep: async () => {},
}));

/**
 * Image analysis failures must say what actually failed. A Gemini outage or a rejected API key
 * is not "your file is unreadable" (422), and a per-minute limit is not "today's quota".
 */
describe("POST /api/v1/documents/extract — image analysis errors", () => {
  let app: Express;
  let token: string;
  const originalKey = env.geminiApiKey;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  beforeEach(async () => {
    app = buildServer(buildContainer(new InMemoryStore()));
    // Set after the container is built: only the image route reads the key per request.
    env.geminiApiKey = "test-key";
    const res = await request(app).post("/api/v1/auth/guest").send({});
    token = res.body.accessToken;
  });

  afterEach(() => {
    env.geminiApiKey = originalKey;
    vi.unstubAllGlobals();
  });

  function stubGemini(status: number, body: string) {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).startsWith("https://generativelanguage.googleapis.com/")) {
        return new Response(body, { status, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const upload = () =>
    request(app)
      .post("/api/v1/documents/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", png, { filename: "photo.png", contentType: "image/png" });

  it("reports a Gemini outage as 503 ai_unavailable, not as an unreadable file", async () => {
    const fetchMock = stubGemini(503, JSON.stringify({ error: { code: 503, message: "overloaded" } }));
    const res = await upload();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "ai_unavailable", code: "AI_UNAVAILABLE", retryable: true });
    expect(res.body.message).toMatch(/temporarily unavailable/);
    // Bounded: three attempts per model, three models at most.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(9);
    expect(JSON.stringify(res.body)).not.toContain("overloaded");
  });

  it("reports a rejected API key (403) as 503 ai_unavailable after one request", async () => {
    const fetchMock = stubGemini(403, JSON.stringify({ error: { code: 403, message: "API key not valid" } }));
    const res = await upload();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "ai_unavailable", code: "AI_UNAVAILABLE", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(res.body)).not.toContain("API key not valid");
  });

  it("keeps 422 extraction_failed when Gemini rejects the image itself (400)", async () => {
    stubGemini(400, JSON.stringify({ error: { code: 400, message: "Unable to process input image" } }));
    const res = await upload();
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("extraction_failed");
  });

  it("reports an exhausted daily quota as 429 ai_quota_exceeded after one request", async () => {
    const fetchMock = stubGemini(429, quotaBody(DAILY));
    const res = await upload();
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "ai_quota_exceeded", code: "AI_QUOTA_EXCEEDED", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an oversized upload as 413 file_too_large", async () => {
    const res = await request(app)
      .post("/api/v1/documents/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.alloc(5 * 1024 * 1024, 1), { filename: "huge.png", contentType: "image/png" });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe("file_too_large");
  });
});
