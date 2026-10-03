import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildContainer } from "../../src/container.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";

/**
 * Request-body contract. A body the server cannot parse is the client's error (4xx with a
 * stable code), never a 500 "internal_error"; and every size the API documents must fit
 * through the JSON parser, in any script.
 */
async function guest() {
  const app = buildServer(buildContainer(new InMemoryStore()));
  const res = await request(app).post("/api/v1/auth/guest");
  return { app, auth: `Bearer ${res.body.accessToken as string}` };
}

describe("request body parsing", () => {
  it("answers malformed JSON with 400 invalid_json, not 500", async () => {
    const { app, auth } = await guest();
    const res = await request(app)
      .post("/api/v1/orchestrator/turn")
      .set("authorization", auth)
      .set("content-type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "invalid_json" });
  });

  it("answers the Vercel runtime's own invalid-JSON error with 400 invalid_json", async () => {
    // On Vercel, reading req.body throws ApiError(400, "Invalid JSON") from the runtime's
    // helper before express.json() runs. Simulate that getter.
    const { app, auth } = await guest();
    const vercelLike = (await import("express")).default();
    vercelLike.use((req, _res, next) => {
      Object.defineProperty(req, "body", {
        configurable: true,
        get() { throw Object.assign(new Error("Invalid JSON"), { statusCode: 400 }); },
      });
      next();
    });
    vercelLike.use(app);
    const res = await request(vercelLike).post("/api/v1/orchestrator/turn").set("authorization", auth).send("{bad");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "invalid_json" });
  });

  it("accepts a document-sized Devanagari utterance (60,000 characters, ~180 kB UTF-8)", async () => {
    // documents.ts returns up to 60,000 extracted characters, and the web client sends them
    // with the next turn. In Hindi that is ~3 bytes per character.
    const { app, auth } = await guest();
    const res = await request(app)
      .post("/api/v1/orchestrator/turn")
      .set("authorization", auth)
      .send({ utterance: "नमस्ते दुनिया ".repeat(60_000 / 14) });
    expect(res.status).toBe(200);
    expect(typeof res.body.message).toBe("string");
  });

  it("answers a body above the limit with 413 payload_too_large, not 500", async () => {
    const { app, auth } = await guest();
    const res = await request(app)
      .post("/api/v1/orchestrator/turn")
      .set("authorization", auth)
      .send({ utterance: "x".repeat(3 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ code: "payload_too_large" });
  });
});
