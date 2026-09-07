import type { Express } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildContainer } from "../../src/container.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { buildServer } from "../../src/server.js";

describe("API integration", () => {
  let app: Express;

  beforeEach(() => {
    app = buildServer(buildContainer(new InMemoryStore()));
  });

  async function signupAndGetToken(email = "demo@example.com"): Promise<string> {
    const res = await request(app).post("/api/v1/auth/signup").send({ email, password: "password123" });
    expect(res.status).toBe(201);
    return res.body.accessToken;
  }

  it("responds healthy", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", provider: "mock" });
  });

  it("rejects unauthenticated access to protected routes", async () => {
    const res = await request(app).get("/api/v1/skills");
    expect(res.status).toBe(401);
  });

  it("signs up, then lists the live skill catalogue", async () => {
    const token = await signupAndGetToken();
    const res = await request(app).get("/api/v1/skills").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = res.body.skills.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["web.search", "docs.summarize", "developer.analyze_repo"]));
    expect(res.body.skills.every((s: { upgradeRequired: boolean }) => s.upgradeRequired === false)).toBe(true);
  });

  it("returns a resolved entitlement snapshot for the new trial account", async () => {
    const token = await signupAndGetToken();
    const res = await request(app).get("/api/v1/entitlements/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe("TRIAL");
    expect(res.body.creditBalance).toBe(50);
  });

  it("runs an orchestrator turn that resolves to the web.search skill and charges credits", async () => {
    const token = await signupAndGetToken();
    const res = await request(app)
      .post("/api/v1/orchestrator/turn")
      .set("Authorization", `Bearer ${token}`)
      .send({ utterance: "please search and compare the best phones, find results" });
    expect(res.status).toBe(200);
    expect(res.body.toolCalls).toHaveLength(1);
    expect(res.body.toolCalls[0].skillId).toBe("web.search");
    expect(res.body.toolCalls[0].outcome.kind).toBe("success");

    const balance = await request(app).get("/api/v1/entitlements/me").set("Authorization", `Bearer ${token}`);
    expect(balance.body.creditBalance).toBe(48); // 50 - 2 credit cost
  });

  it("runs the developer.analyze_repo skill via the direct developer endpoint", async () => {
    const token = await signupAndGetToken();
    const res = await request(app)
      .post("/api/v1/developer/analyze")
      .set("Authorization", `Bearer ${token}`)
      .send({ repoUrl: "https://github.com/example/demo" });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("success");
    expect(res.body.result.output.structure.repoUrl).toBe("https://github.com/example/demo");
  });

  it("creates a task and walks it through pause/resume/cancel", async () => {
    const token = await signupAndGetToken();
    const create = await request(app)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ goal: "Audit my website" });
    expect(create.status).toBe(201);
    const taskId = create.body.id;

    const run = await request(app).post(`/api/v1/tasks/${taskId}/resume`).set("Authorization", `Bearer ${token}`);
    expect(run.body.status).toBe("RUNNING");

    const pause = await request(app).post(`/api/v1/tasks/${taskId}/pause`).set("Authorization", `Bearer ${token}`);
    expect(pause.body.status).toBe("PAUSED");

    const cancel = await request(app).post(`/api/v1/tasks/${taskId}/cancel`).set("Authorization", `Bearer ${token}`);
    expect(cancel.body.status).toBe("CANCELLED");
  });

  it("rejects an invalid task status transition", async () => {
    const token = await signupAndGetToken();
    const create = await request(app)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({ goal: "Do something" });
    const taskId = create.body.id;

    // PENDING -> DONE is not a valid transition (must go through RUNNING first).
    const res = await request(app).post(`/api/v1/tasks/${taskId}/pause`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
  });

  it("usage charge route rejects a skillId that isn't on-device (backend skills are charged automatically)", async () => {
    const token = await signupAndGetToken();
    const res = await request(app)
      .post("/api/v1/usage/charge")
      .set("Authorization", `Bearer ${token}`)
      .send({ skillId: "web.search" });
    expect(res.status).toBe(400);
  });

  it("usage charge route 404s for an unknown skill id", async () => {
    const token = await signupAndGetToken();
    const res = await request(app)
      .post("/api/v1/usage/charge")
      .set("Authorization", `Bearer ${token}`)
      .send({ skillId: "does.not_exist" });
    expect(res.status).toBe(404);
  });

  it("verifies a mock billing webhook", async () => {
    const res = await request(app)
      .post("/api/v1/billing/webhook")
      .send({ purchaseToken: "abc123token", productId: "zarvis_pro_monthly" });
    expect(res.status).toBe(200);
    expect(res.body.acknowledged).toBe(true);
  });
});
