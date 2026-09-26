import type { Express } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildContainer } from "../../src/container.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { buildServer } from "../../src/server.js";

describe("orchestrator conversational greetings", () => {
  let app: Express;

  beforeEach(() => {
    app = buildServer(buildContainer(new InMemoryStore()));
  });

  async function signupAndGetToken(): Promise<string> {
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({ email: "greeting@example.com", password: "password123" });
    expect(res.status).toBe(201);
    return res.body.accessToken;
  }

  it("answers a simple Hi conversationally without executing a developer tool", async () => {
    const token = await signupAndGetToken();

    const res = await request(app)
      .post("/api/v1/orchestrator/turn")
      .set("Authorization", `Bearer ${token}`)
      .send({
        utterance: "Hi",
        isFirstTurn: true,
        conversationId: undefined,
      });

    expect(res.status).toBe(200);
    expect(res.body.toolCalls).toEqual([]);
    expect(res.body.message).toBe("Hi! 👋 I'm ZARVIS. How can I help you today?");

    const balance = await request(app)
      .get("/api/v1/entitlements/me")
      .set("Authorization", `Bearer ${token}`);
    expect(balance.body.creditBalance).toBe(50);
  });

  it("does not let prior conversation context turn a greeting into a tool request", async () => {
    const token = await signupAndGetToken();

    const first = await request(app)
      .post("/api/v1/orchestrator/turn")
      .set("Authorization", `Bearer ${token}`)
      .send({
        utterance: "please analyze my GitHub project",
        isFirstTurn: true,
      });

    expect(first.status).toBe(200);
    expect(first.body.toolCalls[0]?.skillId).toBe("developer.analyze_repo");

    const second = await request(app)
      .post("/api/v1/orchestrator/turn")
      .set("Authorization", `Bearer ${token}`)
      .send({
        utterance: "Hi",
        conversationId: first.body.conversationId,
      });

    expect(second.status).toBe(200);
    expect(second.body.toolCalls).toEqual([]);
    expect(second.body.message).toBe("Hi! 👋 I'm ZARVIS. How can I help you today?");
  });
});
