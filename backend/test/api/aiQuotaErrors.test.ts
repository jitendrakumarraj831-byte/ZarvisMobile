import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { Orchestrator } from "../../src/agents/orchestrator.js";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import type { AIProvider, AIResponse } from "../../src/ai/provider.js";
import { buildContainer } from "../../src/container.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";

const quotaError = () => new AIProviderError("Gemini generateContent failed: 429 Too Many Requests", "AI_QUOTA_EXCEEDED", 429, false, 21_000, "daily");

function appWithProvider(provider: AIProvider) {
  const container = buildContainer(new InMemoryStore());
  const orchestrator = new Orchestrator(container.registry, container.entitlementPort, container.pipeline, provider, { provider: "test", model: "m" }, container.store);
  return buildServer({ ...container, orchestrator, ttsProvider: null });
}

async function guestToken(app: ReturnType<typeof buildServer>): Promise<string> {
  const res = await request(app).post("/api/v1/auth/guest").send({});
  expect(res.status).toBe(201);
  return res.body.accessToken;
}

const quotaProvider: AIProvider = {
  id: "quota",
  generate: vi.fn(async (): Promise<AIResponse> => { throw quotaError(); }),
  async *streamGenerate() {},
};

describe("AI quota errors reach the client as structured, honest errors", () => {
  it("turn-stream sends a structured AI_QUOTA_EXCEEDED error event, not a fake answer", async () => {
    const app = appWithProvider(quotaProvider);
    const token = await guestToken(app);

    const res = await request(app)
      .post("/api/v1/orchestrator/turn-stream")
      .set("Authorization", `Bearer ${token}`)
      .send({ utterance: "write a long essay about rivers" });

    expect(res.status).toBe(200);
    const text = res.text;
    expect(text).not.toContain("event: delta");
    expect(text).not.toContain("event: done");
    const frame = text.split("\n\n").find((f) => f.startsWith("event: error"));
    expect(frame).toBeDefined();
    const data = JSON.parse(frame!.split("data: ")[1]!);
    expect(data).toMatchObject({
      type: "AI_QUOTA_EXCEEDED",
      code: "AI_QUOTA_EXCEEDED",
      retryable: false,
      quotaType: "daily",
      retryAfterMs: 21_000,
    });
    expect(data.error).toMatch(/usage limit for today/);
    expect(typeof data.turnId).toBe("string");
    // Never leaks the provider body or key material.
    expect(text).not.toContain("Gemini generateContent failed");
  });

  it("the meta and done events carry the turn id", async () => {
    const app = appWithProvider({
      id: "ok",
      generate: async () => ({ message: { role: "assistant", content: "fine" }, toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 } }),
      async *streamGenerate() {},
    });
    const token = await guestToken(app);

    const res = await request(app)
      .post("/api/v1/orchestrator/turn-stream")
      .set("Authorization", `Bearer ${token}`)
      .send({ utterance: "tell me a fact about the moon" });

    const frames = res.text.split("\n\n").filter(Boolean);
    const meta = JSON.parse(frames.find((f) => f.startsWith("event: meta"))!.split("data: ")[1]!);
    const done = JSON.parse(frames.find((f) => f.startsWith("event: done"))!.split("data: ")[1]!);
    expect(meta.turnId).toBeTruthy();
    expect(done.turnId).toBe(meta.turnId);
    expect(done.message).toBe("fine");
  });

  it("the JSON turn route answers 429 with the structured body", async () => {
    const app = appWithProvider(quotaProvider);
    const token = await guestToken(app);

    const res = await request(app)
      .post("/api/v1/orchestrator/turn")
      .set("Authorization", `Bearer ${token}`)
      .send({ utterance: "write a long essay about rivers" });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: "AI_QUOTA_EXCEEDED", retryable: false });
  });
});
