import type { Express } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildContainer } from "../../src/container.js";
import { MockGitHubClient } from "../../src/github/githubClient.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { buildServer } from "../../src/server.js";

describe("orchestrator conversational greetings", () => {
  let app: Express;

  beforeEach(() => {
    app = buildServer(buildContainer(new InMemoryStore(), { githubClientFactory: (token) => new MockGitHubClient({ token }) }));
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
    // No repository URL was given, so none is invented: the call stops at validation.
    expect(first.body.toolCalls[0]?.outcome.kind).toBe("validation_failed");
    expect(first.body.toolCalls[0]?.result.status).toBe("USER_ACTION_REQUIRED");

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
  it("greets in the language of the greeting, not only the app's: Hindi or Hinglish gets Hindi even with an English app", async () => {
    const token = await signupAndGetToken();
    const greet = async (utterance: string, locale: string) => {
      const res = await request(app).post("/api/v1/orchestrator/turn").set("Authorization", `Bearer ${token}`).send({ utterance, locale });
      expect(res.status).toBe(200);
      expect(res.body.toolCalls).toEqual([]);
      return res.body.message as string;
    };
    const hindi = "नमस्ते! 👋 मैं ZARVIS हूँ। मैं आपकी कैसे मदद कर सकता हूँ?";
    const english = "Hi! 👋 I'm ZARVIS. How can I help you today?";

    expect(await greet("नमस्ते", "en")).toBe(hindi);
    expect(await greet("Namaste ZARVIS!", "en")).toBe(hindi);
    expect(await greet("namaskar", "en-US")).toBe(hindi);
    // A greeting that is no particular language follows the app language, as before.
    expect(await greet("Hi", "en")).toBe(english);
    expect(await greet("hello", "hi")).toBe(hindi);
    expect(await greet("Hey Jarvis", "en")).toBe(english);
  });

  it("does not repeat repository analysis for a vague follow-up", async () => {
    const token = await signupAndGetToken();

    const first = await request(app)
      .post("/api/v1/orchestrator/turn")
      .set("Authorization", `Bearer ${token}`)
      .send({
        utterance: "analyze https://github.com/example/demo",
        isFirstTurn: true,
      });

    expect(first.status).toBe(200);
    expect(first.body.toolCalls[0]?.skillId).toBe("developer.analyze_repo");

    const second = await request(app)
      .post("/api/v1/orchestrator/turn")
      .set("Authorization", `Bearer ${token}`)
      .send({
        utterance: "Koi error hai kya",
        conversationId: first.body.conversationId,
      });

    expect(second.status).toBe(200);
    expect(second.body.toolCalls).toEqual([]);
  });

});
