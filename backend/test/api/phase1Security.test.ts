import type { Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildContainer, type Container } from "../../src/container.js";
import { MockGitHubClient } from "../../src/github/githubClient.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { PostgresStore } from "../../src/store/postgresStore.js";
import type { Store } from "../../src/store/store.js";
import { CAPABILITIES } from "../../src/capabilities/registry.js";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const STORES: Array<[string, () => Store]> = [
  ["in-memory store", () => new InMemoryStore()],
  ...(TEST_DATABASE_URL ? ([["postgres store", () => new PostgresStore(TEST_DATABASE_URL)]] as Array<[string, () => Store]>) : []),
];
const uniq = (name: string) => `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/**
 * End-to-end API checks for the Phase 1 remediation: sessions/refresh rotation, account
 * continuity, server-issued confirmations, per-user GitHub authorization, capability
 * registry, conversation recovery, rate limiting and security headers.
 */
describe.each(STORES)("Phase 1 security (API, %s)", (_label, makeStore) => {
  let app: Express;
  let container: Container;
  const githubClients: Array<string | undefined> = [];

  beforeEach(() => {
    githubClients.length = 0;
    container = buildContainer(makeStore(), {
      githubClientFactory: (token) => {
        githubClients.push(token);
        return new MockGitHubClient({ token, login: "alice", canPush: token === "ghp_" + "p".repeat(36) });
      },
    });
    app = buildServer(container);
  });

  const guest = async () => {
    const res = await request(app).post("/api/v1/auth/guest");
    expect(res.status).toBe(201);
    return res.body as { accessToken: string; refreshToken: string; accountId: string; isGuest: boolean };
  };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  describe("sessions and refresh tokens", () => {
    it("creates a guest whose credentials the client never chooses", async () => {
      const tokens = await guest();
      expect(tokens.isGuest).toBe(true);
      const me = await request(app).get("/api/v1/auth/me").set(auth(tokens.accessToken));
      expect(me.body).toEqual({ accountId: tokens.accountId, isGuest: true, email: null });
    });

    it("rotates refresh tokens and revokes the whole session when an old one is replayed", async () => {
      const first = await guest();
      const rotated = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: first.refreshToken });
      expect(rotated.status).toBe(200);
      expect(rotated.body.accountId).toBe(first.accountId);

      const replay = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: first.refreshToken });
      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe("refresh_token_reused");

      // The newest token is now dead too, and so is the access token for that session.
      const afterReuse = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: rotated.body.refreshToken });
      expect(afterReuse.status).toBe(401);
      const api = await request(app).get("/api/v1/entitlements/me").set(auth(rotated.body.accessToken));
      expect(api.status).toBe(401);
      expect(api.body.code).toBe("session_revoked");
    });

    it("logout revokes the session server-side immediately", async () => {
      const tokens = await guest();
      expect((await request(app).post("/api/v1/auth/logout").set(auth(tokens.accessToken))).status).toBe(204);
      const api = await request(app).get("/api/v1/entitlements/me").set(auth(tokens.accessToken));
      expect(api.status).toBe(401);
      const refresh = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: tokens.refreshToken });
      expect(refresh.status).toBe(401);
      expect(refresh.body.code).toBe("session_revoked");
    });

    it("an invalid refresh token is a 401 with a session code, never a new account", async () => {
      const res = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: "garbage" });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("session_invalid");
    });

    it("a deleted account's tokens stop working", async () => {
      const tokens = await guest();
      expect((await request(app).delete("/api/v1/account").set(auth(tokens.accessToken))).status).toBe(204);
      expect((await request(app).get("/api/v1/entitlements/me").set(auth(tokens.accessToken))).status).toBe(401);
      expect((await request(app).post("/api/v1/auth/refresh").send({ refreshToken: tokens.refreshToken })).status).toBe(401);
    });
  });

  describe("account continuity (guest → linked email → another device)", () => {
    it("links a guest to an email and signs the same account in elsewhere with the same data", async () => {
      const device = await guest();
      await request(app).post("/api/v1/tasks").set(auth(device.accessToken)).send({ goal: "Plan my week" });

      const email = uniq("Asha");
      const link = await request(app)
        .post("/api/v1/auth/link")
        .set(auth(device.accessToken))
        .send({ email, password: "correct horse battery" });
      expect(link.status).toBe(200);
      expect(link.body).toEqual({ accountId: device.accountId, isGuest: false, email: email.toLowerCase() });

      const other = await request(app).post("/api/v1/auth/login").send({ email, password: "correct horse battery" });
      expect(other.status).toBe(200);
      expect(other.body.accountId).toBe(device.accountId);
      const tasks = await request(app).get("/api/v1/tasks").set(auth(other.body.accessToken));
      expect(tasks.body.tasks.map((t: { goal: string }) => t.goal)).toEqual(["Plan my week"]);

      // The original device's session keeps working (independent sessions).
      expect((await request(app).get("/api/v1/entitlements/me").set(auth(device.accessToken))).status).toBe(200);
    });

    it("refuses to link an email that belongs to another account, and refuses re-linking", async () => {
      const takenEmail = uniq("taken");
      await request(app).post("/api/v1/auth/signup").send({ email: takenEmail, password: "password123" });
      const device = await guest();
      const taken = await request(app).post("/api/v1/auth/link").set(auth(device.accessToken)).send({ email: takenEmail, password: "password123" });
      expect(taken.status).toBe(409);
      expect(taken.body.code).toBe("email_taken");

      await request(app).post("/api/v1/auth/link").set(auth(device.accessToken)).send({ email: uniq("mine"), password: "password123" });
      const again = await request(app).post("/api/v1/auth/link").set(auth(device.accessToken)).send({ email: uniq("other"), password: "password123" });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("not_guest");
    });

    it("guests cannot be logged into with a password, and reserved guest domains cannot be registered", async () => {
      const res = await request(app).post("/api/v1/auth/signup").send({ email: "someone@device.zarvismobile.local", password: "password123" });
      expect(res.status).toBe(400);
    });

    it("still accepts legacy guest bootstrap signups from older app builds, recorded as guests", async () => {
      const email = `guest-${crypto.randomUUID()}@device.zarvismobile.local`;
      const res = await request(app).post("/api/v1/auth/signup").send({ email, password: "11111111-2222-3333-4444-555555555555" });
      expect(res.status).toBe(201);
      expect(res.body.isGuest).toBe(true);
      const login = await request(app).post("/api/v1/auth/login").send({ email, password: "11111111-2222-3333-4444-555555555555" });
      expect(login.status).toBe(401);
    });
  });

  describe("server-issued single-action confirmations", () => {
    async function proAccountWithGitHub(tokenValue = "ghp_" + "p".repeat(36)) {
      const tokens = await guest();
      await container.store.updateAccountPlan(tokens.accountId, "PRO");
      const connect = await request(app).post("/api/v1/integrations/github").set(auth(tokens.accessToken)).send({ token: tokenValue });
      expect(connect.status).toBe(200);
      return tokens;
    }

    it("ignores a client 'confirmed' flag and returns a pending confirmation instead", async () => {
      const tokens = await proAccountWithGitHub();
      const res = await request(app)
        .post("/api/v1/developer/implement")
        .set(auth(tokens.accessToken))
        .send({ repoUrl: "https://github.com/acme/demo", requirement: "add a README badge", confirmed: true });
      expect(res.status).toBe(200);
      expect(res.body.kind).toBe("confirmation_required");
      expect(res.body.structured.status).toBe("CONFIRMATION_REQUIRED");
      expect(res.body.confirmation.action).toContain("As GitHub user alice");
      expect(res.body.confirmation.action).toContain("acme/demo");
      expect(res.body.confirmation.action).toContain("add a README badge");
    });

    it("approve runs exactly that action once; a replay and another account both get 404", async () => {
      const tokens = await proAccountWithGitHub();
      const pending = await request(app)
        .post("/api/v1/developer/implement")
        .set(auth(tokens.accessToken))
        .send({ repoUrl: "https://github.com/acme/demo", requirement: "add a README badge" });
      const id = pending.body.confirmation.id as string;

      const intruder = await guest();
      expect((await request(app).get(`/api/v1/confirmations/${id}`).set(auth(intruder.accessToken))).status).toBe(404);
      expect((await request(app).post(`/api/v1/confirmations/${id}/approve`).set(auth(intruder.accessToken))).status).toBe(404);

      const view = await request(app).get(`/api/v1/confirmations/${id}`).set(auth(tokens.accessToken));
      expect(view.body.status).toBe("PENDING");

      const approve = await request(app).post(`/api/v1/confirmations/${id}/approve`).set(auth(tokens.accessToken));
      expect(approve.status).toBe(200);
      // The mock generator returns a non-JSON plan, so the skill fails honestly — but it ran.
      expect(["success", "execution_failed"]).toContain(approve.body.outcome.kind);
      expect(approve.body.result.status).not.toBe("CONFIRMATION_REQUIRED");

      const replay = await request(app).post(`/api/v1/confirmations/${id}/approve`).set(auth(tokens.accessToken));
      expect(replay.status).toBe(404);
      expect(replay.body.code).toBe("confirmation_unavailable");
    });

    it("decline runs nothing and the confirmation cannot be approved afterwards", async () => {
      const tokens = await proAccountWithGitHub();
      const pending = await request(app)
        .post("/api/v1/developer/implement")
        .set(auth(tokens.accessToken))
        .send({ repoUrl: "https://github.com/acme/demo", requirement: "x" });
      const id = pending.body.confirmation.id as string;
      const decline = await request(app).post(`/api/v1/confirmations/${id}/decline`).set(auth(tokens.accessToken));
      expect(decline.status).toBe(200);
      expect(decline.body.result.status).toBe("DENIED");
      expect((await request(app).post(`/api/v1/confirmations/${id}/approve`).set(auth(tokens.accessToken))).status).toBe(404);
    });
  });

  describe("per-user GitHub authorization", () => {
    it("analyze without a connected account runs anonymously — never with a server token", async () => {
      const tokens = await guest();
      const res = await request(app).post("/api/v1/developer/analyze").set(auth(tokens.accessToken)).send({ repoUrl: "https://github.com/acme/demo" });
      expect(res.body.kind).toBe("success");
      expect(githubClients).toEqual([undefined]);
    });

    it("stores the token encrypted and never returns it", async () => {
      const tokens = await guest();
      const token = "ghp_" + "s".repeat(36);
      const res = await request(app).post("/api/v1/integrations/github").set(auth(tokens.accessToken)).send({ token });
      expect(res.body).toMatchObject({ connected: true, login: "alice" });
      expect(JSON.stringify(res.body)).not.toContain(token);
      const stored = await container.store.getGitHubConnection(tokens.accountId);
      expect(stored!.encryptedToken).not.toContain(token);
      const status = await request(app).get("/api/v1/integrations/github").set(auth(tokens.accessToken));
      expect(JSON.stringify(status.body)).not.toContain(token);
      expect((await request(app).delete("/api/v1/integrations/github").set(auth(tokens.accessToken))).status).toBe(204);
      expect((await request(app).get("/api/v1/integrations/github").set(auth(tokens.accessToken))).body.connected).toBe(false);
    });

    it("implement is refused before any confirmation when the user's GitHub identity cannot push", async () => {
      const tokens = await guest();
      await container.store.updateAccountPlan(tokens.accountId, "PRO");
      await request(app).post("/api/v1/integrations/github").set(auth(tokens.accessToken)).send({ token: "ghp_" + "n".repeat(36) });
      const res = await request(app)
        .post("/api/v1/developer/implement")
        .set(auth(tokens.accessToken))
        .send({ repoUrl: "https://github.com/someone-else/repo", requirement: "x" });
      expect(res.body).toMatchObject({ kind: "execution_failed", result: { reason: "not_authorized" } });
      expect(res.body.structured.status).toBe("FAILED");
    });

    it("implement without a connected GitHub account is refused with an honest reason, no confirmation issued", async () => {
      const tokens = await guest();
      await container.store.updateAccountPlan(tokens.accountId, "PRO");
      const res = await request(app)
        .post("/api/v1/developer/implement")
        .set(auth(tokens.accessToken))
        .send({ repoUrl: "https://github.com/acme/demo", requirement: "x" });
      expect(res.body).toMatchObject({ kind: "execution_failed", result: { reason: "github_not_connected" } });
    });
  });

  describe("capability registry, recovery, limits and headers", () => {
    it("serves the same capability registry the code defines", async () => {
      const res = await request(app).get("/api/v1/capabilities");
      expect(res.status).toBe(200);
      expect(res.body.capabilities).toEqual(JSON.parse(JSON.stringify(CAPABILITIES)));
    });

    it("recovers a conversation's persisted messages for its owner only", async () => {
      const tokens = await guest();
      const turn = await request(app).post("/api/v1/orchestrator/turn").set(auth(tokens.accessToken)).send({ utterance: "hello" });
      const id = turn.body.conversationId;
      const history = await request(app).get(`/api/v1/conversations/${id}/messages`).set(auth(tokens.accessToken));
      expect(history.body.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
      const other = await guest();
      expect((await request(app).get(`/api/v1/conversations/${id}/messages`).set(auth(other.accessToken))).status).toBe(404);
    });

    it("rate-limits login attempts per client", async () => {
      let last = 0;
      for (let i = 0; i < 21; i += 1) {
        last = (await request(app).post("/api/v1/auth/login").send({ email: "x@example.com", password: "wrong-password" })).status;
      }
      expect(last).toBe(429);
    });

    it("sends a strict Content-Security-Policy", async () => {
      const res = await request(app).get("/health");
      expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
      expect(res.headers["content-security-policy"]).not.toContain("unsafe-inline");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("streams real progress events and no simulated drip", async () => {
      const tokens = await guest();
      const res = await request(app)
        .post("/api/v1/orchestrator/turn-stream")
        .set(auth(tokens.accessToken))
        .send({ utterance: "please search and compare the best phones" });
      const events = [...res.text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
      expect(events[0]).toBe("meta");
      expect(events).toContain("progress");
      expect(events.filter((e) => e === "delta")).toHaveLength(1);
      expect(events.at(-1)).toBe("done");
    });
  });
});
