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
    // ZARVIS already answered in this chat: it picks up again instead of introducing itself a second time.
    expect(second.body.message).toBe("Hi again! What would you like to do next?");
  });

  it("introduces itself once per conversation and never repeats the same greeting twice in a row", async () => {
    const token = await signupAndGetToken();
    const say = async (utterance: string, conversationId?: string) => {
      const res = await request(app).post("/api/v1/orchestrator/turn").set("Authorization", `Bearer ${token}`).send({ utterance, conversationId, locale: "en" });
      expect(res.status).toBe(200);
      expect(res.body.toolCalls).toEqual([]);
      return res.body as { message: string; conversationId: string };
    };

    const first = await say("Hi");
    expect(first.message).toBe("Hi! 👋 I'm ZARVIS. How can I help you today?");
    const replies = [first.message];
    for (const greeting of ["hello", "hey", "hi"]) replies.push((await say(greeting, first.conversationId)).message);

    expect(replies.slice(1).every((reply) => !reply.includes("I'm ZARVIS"))).toBe(true);
    for (let i = 1; i < replies.length; i += 1) expect(replies[i]).not.toBe(replies[i - 1]);

    // A new chat is a new conversation: the introduction comes back there.
    expect((await say("hi")).message).toBe("Hi! 👋 I'm ZARVIS. How can I help you today?");
  });

  it("answers a time-of-day greeting in kind", async () => {
    const token = await signupAndGetToken();
    const res = await request(app).post("/api/v1/orchestrator/turn").set("Authorization", `Bearer ${token}`).send({ utterance: "Good morning!", locale: "en" });
    expect(res.body.message).toBe("Good morning! 👋 I'm ZARVIS. How can I help you today?");
    const again = await request(app).post("/api/v1/orchestrator/turn").set("Authorization", `Bearer ${token}`)
      .send({ utterance: "good evening", conversationId: res.body.conversationId, locale: "en" });
    expect(again.body.message).toBe("Good evening! What would you like to do next?");
  });

  it("greets in the language of the greeting and in the user's script, not only the app's", async () => {
    const token = await signupAndGetToken();
    const greet = async (utterance: string, locale: string) => {
      const res = await request(app).post("/api/v1/orchestrator/turn").set("Authorization", `Bearer ${token}`).send({ utterance, locale });
      expect(res.status).toBe(200);
      expect(res.body.toolCalls).toEqual([]);
      return res.body.message as string;
    };
    const hindi = "नमस्ते! 👋 मैं ZARVIS हूँ। मैं आपकी कैसे मदद कर सकता हूँ?";
    const hinglish = "Namaste! 👋 Main ZARVIS hoon. Bataiye, main aapki kya madad kar sakta hoon?";
    const english = "Hi! 👋 I'm ZARVIS. How can I help you today?";

    expect(await greet("नमस्ते", "en")).toBe(hindi);
    // Typed in Latin letters, so answered in Latin letters (Hinglish), not in Devanagari.
    expect(await greet("Namaste ZARVIS!", "en")).toBe(hinglish);
    expect(await greet("namaskar", "en-US")).toBe(hinglish);
    // A greeting that is no particular language follows the app language, as before.
    expect(await greet("Hi", "en")).toBe(english);
    expect(await greet("hello", "hi")).toBe(hindi);
    expect(await greet("Hey Jarvis", "en")).toBe(english);
  });

  it("keeps the language of the conversation for a greeting that has none of its own", async () => {
    const token = await signupAndGetToken();
    const first = await request(app).post("/api/v1/orchestrator/turn").set("Authorization", `Bearer ${token}`).send({ utterance: "namaste", locale: "en" });
    expect(first.body.message).toMatch(/^Namaste!/);
    // "hi" says nothing about language; this chat is in Hinglish, so the reply stays Hinglish despite the English app.
    const second = await request(app).post("/api/v1/orchestrator/turn").set("Authorization", `Bearer ${token}`)
      .send({ utterance: "hi", conversationId: first.body.conversationId, locale: "en" });
    expect(second.body.message).toBe("Phir se namaste! Ab kya karna hai?");
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
