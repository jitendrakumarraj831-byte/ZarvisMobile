import { generateKeyPairSync, createSign, type KeyObject } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleIdTokenVerifier, GoogleTokenError } from "../../src/auth/googleIdToken.js";
import { buildContainer } from "../../src/container.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };

function b64(v: unknown): string {
  return Buffer.from(JSON.stringify(v)).toString("base64url");
}

function idToken(claims: Record<string, unknown> = {}, key: KeyObject = privateKey, header: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const body = {
    iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "g-123", email: "Asha@Gmail.com", email_verified: true,
    name: "Asha", picture: "https://lh3.googleusercontent.com/a.png", iat: now, exp: now + 3600, ...claims,
  };
  const head = b64({ alg: "RS256", kid: "k1", typ: "JWT", ...header });
  const unsigned = `${head}.${b64(body)}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(key).toString("base64url")}`;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "cache-control": "public, max-age=3600" } })));
});

describe("GoogleIdTokenVerifier", () => {
  const verifier = () => new GoogleIdTokenVerifier(CLIENT_ID);

  it("accepts a valid token and normalises the email", async () => {
    expect(await verifier().verify(idToken())).toMatchObject({ sub: "g-123", email: "asha@gmail.com", name: "Asha" });
  });

  it.each([
    ["wrong audience", idToken({ aud: "someone-else" })],
    ["wrong issuer", idToken({ iss: "https://evil.example" })],
    ["expired", idToken({ exp: 1 })],
    ["unverified email", idToken({ email_verified: false })],
    ["forged signature", idToken({}, other.privateKey)],
    ["alg none", idToken({}, privateKey, { alg: "none" })],
    ["unknown kid", idToken({}, privateKey, { kid: "nope" })],
    ["garbage", "abc.def"],
  ])("rejects %s", async (_name, token) => {
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(GoogleTokenError);
  });

  it("caches Google's keys", async () => {
    const v = verifier();
    await v.verify(idToken());
    await v.verify(idToken());
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/v1/auth/google", () => {
  const app = (configured = true) =>
    buildServer(buildContainer(new InMemoryStore(), { googleVerifier: configured ? new GoogleIdTokenVerifier(CLIENT_ID) : null }));

  it("reports availability via /auth/config", async () => {
    const on = await request(app()).get("/api/v1/auth/config");
    expect(on.body.googleClientId).toBeDefined();
    const off = await request(app(false)).get("/api/v1/auth/config");
    expect(off.body.googleClientId).toBeNull();
  });

  it("is 503 when Google is not configured", async () => {
    const res = await request(app(false)).post("/api/v1/auth/google").send({ idToken: idToken() });
    expect(res.status).toBe(503);
  });

  it("rejects an invalid token with 401", async () => {
    const res = await request(app()).post("/api/v1/auth/google").send({ idToken: idToken({ aud: "x" }) });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("google_token_invalid");
  });

  it("creates an account, then signs the same Google user back into it", async () => {
    const a = app();
    const first = await request(a).post("/api/v1/auth/google").send({ idToken: idToken() });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ isGuest: false, email: "asha@gmail.com" });
    const second = await request(a).post("/api/v1/auth/google").send({ idToken: idToken() });
    expect(second.body.accountId).toBe(first.body.accountId);
    const me = await request(a).get("/api/v1/auth/me").set("Authorization", `Bearer ${second.body.accessToken}`);
    expect(me.body).toMatchObject({ email: "asha@gmail.com", name: "Asha" });
  });

  it("upgrades the calling guest in place, keeping its account", async () => {
    const a = app();
    const guest = await request(a).post("/api/v1/auth/guest");
    const res = await request(a).post("/api/v1/auth/google").set("Authorization", `Bearer ${guest.body.accessToken}`).send({ idToken: idToken() });
    expect(res.body.accountId).toBe(guest.body.accountId);
    expect(res.body.isGuest).toBe(false);
  });

  it("links Google to an existing password account with the same verified email", async () => {
    const a = app();
    const signup = await request(a).post("/api/v1/auth/signup").send({ email: "asha@gmail.com", password: "password123" });
    const res = await request(a).post("/api/v1/auth/google").send({ idToken: idToken() });
    expect(res.body.accountId).toBe(signup.body.accountId);
    const login = await request(a).post("/api/v1/auth/login").send({ email: "asha@gmail.com", password: "password123" });
    expect(login.status).toBe(200);
  });

  it("a Google-only account cannot be entered with a guessed password", async () => {
    const a = app();
    await request(a).post("/api/v1/auth/google").send({ idToken: idToken() });
    const login = await request(a).post("/api/v1/auth/login").send({ email: "asha@gmail.com", password: "password123" });
    expect(login.status).toBe(401);
  });
});
