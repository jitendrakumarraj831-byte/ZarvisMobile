import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelGateway } from "../../src/ai/providerFactory.js";
import { buildContainer } from "../../src/container.js";
import { logger } from "../../src/security/redact.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import type { TtsProvider } from "../../src/tts/provider.js";
import { DAILY, quotaBody } from "../ai/geminiFixtures.js";
import {
  GEMINI_KEY,
  OPENROUTER_KEY,
  fakeEnv,
  geminiCall,
  geminiFail,
  geminiText,
  openRouterCall,
  openRouterFail,
  openRouterText,
  stubProviders,
  type Responder,
} from "../ai/gatewayHarness.js";
import { FakeTtsProvider, unavailable } from "../tts/helpers.js";

vi.mock("../../src/ai/geminiErrors.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/ai/geminiErrors.js")>()),
  sleep: async () => {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function appWith(envOverrides: Parameters<typeof fakeEnv>[0] = {}, options: { tts?: TtsProvider | null; isProduction?: boolean } = {}) {
  const gateway = createModelGateway(fakeEnv(envOverrides), { isProduction: options.isProduction ?? true });
  const container = buildContainer(new InMemoryStore(), { modelGateway: gateway });
  return buildServer({ ...container, ttsProvider: options.tts ?? null });
}

async function guestToken(app: ReturnType<typeof buildServer>): Promise<string> {
  const res = await request(app).post("/api/v1/auth/guest").send({});
  expect(res.status).toBe(201);
  return res.body.accessToken;
}

const frames = (text: string) =>
  text
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => ({ event: /^event: (.+)$/m.exec(frame)?.[1], data: JSON.parse(/^data: (.+)$/m.exec(frame)?.[1] ?? "null") as Record<string, any> }));

/** A planner step is the Gemini call that carries function declarations. */
const plannerOnly = (planner: Responder): Responder => (call) => (call.body?.tools?.[0]?.functionDeclarations ? planner(call) : geminiText("x")(call));

describe("GET /health", () => {
  it("keeps its shape, and adds aiFallback only while a fallback provider is active", async () => {
    const both = await request(appWith()).get("/health");
    // The default OpenRouter model declares no tools, so a chat turn cannot fall back: /health says so.
    expect(both.body).toEqual({ status: "ok", provider: "google", aiFallback: true, aiFallbackTools: false, database: "not_configured" });

    const withTools = await request(appWith({ openRouterModelCapabilities: "tools" })).get("/health");
    expect(withTools.body).toEqual({ status: "ok", provider: "google", aiFallback: true, aiFallbackTools: true, database: "not_configured" });

    const geminiOnly = await request(appWith({ openRouterApiKey: undefined })).get("/health");
    expect(geminiOnly.body).toEqual({ status: "ok", provider: "google", database: "not_configured" });

    const openRouterOnly = await request(appWith({ geminiApiKey: undefined })).get("/health");
    expect(openRouterOnly.body).toEqual({ status: "ok", provider: "openrouter", database: "not_configured" });

    const switchedOff = await request(appWith({ aiFallbackProvider: "none" })).get("/health");
    expect(switchedOff.body).toEqual({ status: "ok", provider: "google", database: "not_configured" });
  });

  it("an unconfigured deployment says so: production fails closed, development shows the mock", async () => {
    const none = { geminiApiKey: undefined, openRouterApiKey: undefined };
    expect((await request(appWith(none, { isProduction: true })).get("/health")).body.provider).toBe("none");
    expect((await request(appWith(none, { isProduction: false })).get("/health")).body.provider).toBe("mock");
  });

  it("never discloses a key, a model name or an address", async () => {
    const res = await request(appWith({ openRouterModelCapabilities: "tools" })).get("/health");
    const text = JSON.stringify(res.body) + JSON.stringify(res.headers);
    expect(text).not.toContain(GEMINI_KEY);
    expect(text).not.toContain(OPENROUTER_KEY);
    expect(text).not.toMatch(/gemini-3|openrouter\/free|openrouter\.ai|generativelanguage/);
  });
});

describe("request ids and log correlation", () => {
  it("every response carries a distinct X-Request-Id, including errors", async () => {
    const app = appWith();
    const ids = new Set<string>();
    for (const [method, path] of [["get", "/health"], ["get", "/api/v1/skills"], ["get", "/no/such/route"]] as const) {
      const res = await request(app)[method](path);
      expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
      ids.add(res.headers["x-request-id"] as string);
    }
    expect(ids.size).toBe(3);
  });

  it("the AI call's log line carries the request id, turn id and client turn id of the request that caused it", async () => {
    stubProviders({ gemini: plannerOnly(geminiText("Rivers flow downhill.")) });
    const lines: Array<{ message: string; data: Record<string, any> }> = [];
    vi.spyOn(logger, "info").mockImplementation((message: string, data?: Record<string, unknown>) => void lines.push({ message, data: (data ?? {}) as Record<string, any> }));
    const app = appWith();
    const token = await guestToken(app);

    const res = await request(app)
      .post("/api/v1/orchestrator/turn-stream")
      .set("Authorization", `Bearer ${token}`)
      .send({ utterance: "explain how rivers form", clientTurnId: "client-turn-0001" });

    const requestId = res.headers["x-request-id"];
    const meta = frames(res.text).find((frame) => frame.event === "meta")!.data;
    const call = lines.find((line) => line.message === "AI call")!.data;
    expect(call).toMatchObject({ requestId, turnId: meta.turnId, clientTurnId: "client-turn-0001", provider: "google", finalStatus: "success", fallback: false });
    const finished = lines.find((line) => line.message === "Turn finished")!.data;
    expect(finished).toMatchObject({ requestId, turnId: meta.turnId, clientTurnId: "client-turn-0001", aiProviders: ["google"] });
  });
});

describe("what a client sees when the gateway falls back or fails", () => {
  it("a turn answered by the fallback model looks like any other turn: no provider, model or fallback detail", async () => {
    stubProviders({
      gemini: plannerOnly(geminiFail(429, quotaBody(DAILY))),
      openrouter: openRouterText("Rivers form from rain and snow melt.", "vendor/secret-served-model:free"),
    });
    const app = appWith({ openRouterModelCapabilities: "tools" });
    const token = await guestToken(app);

    const res = await request(app).post("/api/v1/orchestrator/turn-stream").set("Authorization", `Bearer ${token}`).send({ utterance: "explain how rivers form" });

    const events = frames(res.text);
    expect(events.map((event) => event.event)).toEqual(expect.arrayContaining(["meta", "progress", "delta", "done"]));
    expect(events.find((event) => event.event === "done")!.data.message).toBe("Rivers form from rain and snow melt.");
    expect(res.text).not.toMatch(/openrouter|vendor\/|secret-served|fallback|GEMINI_QUOTA|generativelanguage/i);
    expect(res.text).not.toContain(OPENROUTER_KEY);
  });

  it("when every provider fails the stream ends with ONE structured error and nothing internal", async () => {
    stubProviders({ gemini: plannerOnly(geminiFail(429, quotaBody(DAILY))), openrouter: openRouterFail(503, `overloaded; key ${OPENROUTER_KEY}`) });
    const warnings: Array<{ message: string; data: Record<string, any> }> = [];
    vi.spyOn(logger, "warn").mockImplementation((message: string, data?: Record<string, unknown>) => void warnings.push({ message, data: (data ?? {}) as Record<string, any> }));
    const app = appWith({ openRouterModelCapabilities: "tools" });
    const token = await guestToken(app);

    const res = await request(app).post("/api/v1/orchestrator/turn-stream").set("Authorization", `Bearer ${token}`).send({ utterance: "explain how rivers form" });

    const events = frames(res.text);
    expect(events.filter((event) => event.event === "error")).toHaveLength(1);
    expect(events.some((event) => event.event === "done" || event.event === "delta")).toBe(false);
    const failure = events.find((event) => event.event === "error")!.data;
    expect(failure).toMatchObject({ code: "AI_UNAVAILABLE", retryable: true });
    expect(failure.error).toMatch(/temporarily unavailable/);
    expect(res.text).not.toMatch(/openrouter|generativelanguage|overloaded|kind|AI_PROVIDER/i);
    expect(res.text).not.toContain(OPENROUTER_KEY);

    // The operator, unlike the client, gets everything: which provider, which kind, every attempt.
    const stopped = warnings.find((line) => line.message === "Streaming turn stopped by the AI provider")!.data;
    expect(stopped).toMatchObject({ code: "AI_UNAVAILABLE", kind: "AI_PROVIDER_UNAVAILABLE", provider: "openrouter", turnId: failure.turnId });
    expect(stopped.attempts.map((attempt: { provider: string; kind: string }) => [attempt.provider, attempt.kind])).toEqual([
      ["google", "AI_PROVIDER_QUOTA_EXCEEDED"],
      ["openrouter", "AI_PROVIDER_UNAVAILABLE"],
    ]);
  });

  it("a rejected provider key reaches a client only as 'temporarily unavailable', never as an auth problem or a key", async () => {
    stubProviders({ gemini: plannerOnly(geminiFail(403, JSON.stringify({ error: { message: `API key not valid ${GEMINI_KEY}` } }))), openrouter: openRouterText("must not run") });
    const app = appWith();
    const token = await guestToken(app);

    const res = await request(app).post("/api/v1/orchestrator/turn").set("Authorization", `Bearer ${token}`).send({ utterance: "explain how rivers form" });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ type: "AI_UNAVAILABLE", code: "AI_UNAVAILABLE", error: expect.stringMatching(/temporarily unavailable/), retryable: false });
    expect(JSON.stringify(res.body)).not.toMatch(/key|auth|403|forbidden/i);
  });

  it("a capability gap is a clear 503 and sends nothing to any provider", async () => {
    const stub = stubProviders({ openrouter: openRouterText("must not run") });
    const app = appWith({ geminiApiKey: undefined }); // OpenRouter only, no tool support declared
    const token = await guestToken(app);

    const res = await request(app).post("/api/v1/orchestrator/turn").set("Authorization", `Bearer ${token}`).send({ utterance: "explain how rivers form" });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/needs an AI capability that is not available/);
    expect(stub.calls).toHaveLength(0);
  });

  it("with OpenRouter configured to declare tools it can run the whole planner on its own", async () => {
    stubProviders({ openrouter: openRouterCall("web-search", { query: "weather" }) });
    // Only checks the planner request/response round trip; the search skill is the development mock here.
    const app = appWith({ geminiApiKey: undefined, openRouterModelCapabilities: "tools" });
    const token = await guestToken(app);
    const res = await request(app).post("/api/v1/orchestrator/turn").set("Authorization", `Bearer ${token}`).send({ utterance: "search the weather for me" });
    expect(res.status).toBe(200);
    expect(res.body.toolCalls[0]).toMatchObject({ skillId: "web.search" });
  });
});

describe("POST /api/v1/documents/extract through the gateway", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const upload = (app: ReturnType<typeof buildServer>, token: string, type = "image/png", name = "photo.png") =>
    request(app).post("/api/v1/documents/extract").set("Authorization", `Bearer ${token}`).attach("file", png, { filename: name, contentType: type });

  it("an image is read by Gemini, and by a vision-capable OpenRouter model when Gemini is out of quota", async () => {
    const stub = stubProviders({ gemini: geminiFail(429, quotaBody(DAILY)), openrouter: openRouterText("A cat on a sofa.") });
    const app = appWith({ openRouterModelCapabilities: "vision" });
    const token = await guestToken(app);

    const res = await upload(app, token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: "A cat on a sofa.", kind: "image" });
    expect(stub.gemini).toHaveLength(1);
    expect(stub.openrouter).toHaveLength(1);
  });

  it("without a vision model to fall back to, the quota error is the honest answer and the image is not described by a text-only model", async () => {
    const stub = stubProviders({ gemini: geminiFail(429, quotaBody(DAILY)), openrouter: openRouterText("must not run") });
    const app = appWith(); // OpenRouter has no `vision`
    const token = await guestToken(app);

    const res = await upload(app, token);

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "ai_quota_exceeded", code: "AI_QUOTA_EXCEEDED", retryable: false });
    expect(stub.openrouter).toHaveLength(0);
  });

  it("an image type the OpenRouter model does not accept (HEIC) is not routed there", async () => {
    const stub = stubProviders({ gemini: geminiFail(429, quotaBody(DAILY)), openrouter: openRouterText("must not run") });
    const app = appWith({ openRouterModelCapabilities: "vision" });
    const token = await guestToken(app);

    const res = await upload(app, token, "image/heic", "photo.heic");

    expect(res.status).toBe(429);
    expect(stub.openrouter).toHaveLength(0);
  });

  it("when no configured model can read images it says so (503) and never sends the upload anywhere", async () => {
    const stub = stubProviders({ openrouter: openRouterText("must not run") });
    const app = appWith({ geminiApiKey: undefined });
    const token = await guestToken(app);

    const res = await upload(app, token);

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("image_analysis_unavailable");
    expect(stub.calls).toHaveLength(0);
  });

  it("keeps the existing validation: unsupported types, size limit and the 400 'unreadable image' answer", async () => {
    const stub = stubProviders({ gemini: geminiFail(400, JSON.stringify({ error: { message: "Unable to process input image" } })), openrouter: openRouterText("must not run") });
    const app = appWith({ openRouterModelCapabilities: "vision" });
    const token = await guestToken(app);

    expect((await upload(app, token, "application/zip", "a.zip")).status).toBe(415);
    expect((await request(app).post("/api/v1/documents/extract").set("Authorization", `Bearer ${token}`).attach("file", Buffer.alloc(5 * 1024 * 1024, 1), { filename: "huge.png", contentType: "image/png" })).status).toBe(413);
    const unreadable = await upload(app, token);
    expect(unreadable.status).toBe(422);
    expect(unreadable.body.error).toBe("extraction_failed");
    expect(stub.openrouter).toHaveLength(0);
  });
});

describe("text to speech is independent of the chat gateway", () => {
  it("a voice failure is never answered by an AI provider, and no AI provider is asked to speak", async () => {
    const stub = stubProviders({ gemini: geminiText("must not run"), openrouter: openRouterText("must not run") });
    const app = appWith({ openRouterModelCapabilities: "tools,vision" }, { tts: new FakeTtsProvider({ error: unavailable() }) });
    const token = await guestToken(app);

    for (const path of ["/api/v1/tts/synthesize", "/api/v1/tts/synthesize-stream"]) {
      const res = await request(app).post(path).set("Authorization", `Bearer ${token}`).send({ text: "Namaste" });
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: "tts_unavailable", retryable: true });
    }
    expect(stub.calls).toHaveLength(0);
  });

  it("the voice does not depend on which AI provider answers chat: OpenRouter alone, and it still speaks", async () => {
    const stub = stubProviders({ openrouter: openRouterText("must not run") });
    const voice = new FakeTtsProvider();
    const app = appWith({ geminiApiKey: undefined }, { tts: voice });
    const token = await guestToken(app);

    const res = await request(app).post("/api/v1/tts/synthesize").set("Authorization", `Bearer ${token}`).send({ text: "Namaste" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/wav");
    expect(voice.calls).toHaveLength(1);
    expect(stub.calls).toHaveLength(0);
  });

  it("with spoken replies switched off (TTS_PROVIDER=none) both routes say so, and no AI provider is asked", async () => {
    const stub = stubProviders({ gemini: geminiText("must not run"), openrouter: openRouterText("must not run") });
    const app = appWith({}, { tts: null });
    const token = await guestToken(app);

    for (const path of ["/api/v1/tts/synthesize", "/api/v1/tts/synthesize-stream"]) {
      const res = await request(app).post(path).set("Authorization", `Bearer ${token}`).send({ text: "Namaste" });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("tts_disabled");
    }
    expect(stub.calls).toHaveLength(0);
  });

  it("a chat turn never triggers speech: the turn and TTS are separate requests", async () => {
    const stub = stubProviders({ gemini: plannerOnly(geminiText("Hello there, a spoken-length reply that is long enough.")) });
    const voice = new FakeTtsProvider();
    const app = appWith({}, { tts: voice });
    const token = await guestToken(app);

    const res = await request(app).post("/api/v1/orchestrator/turn-stream").set("Authorization", `Bearer ${token}`).send({ utterance: "explain how rivers form" });

    expect(res.status).toBe(200);
    expect(voice.calls).toHaveLength(0);
    expect(stub.calls.length).toBeGreaterThan(0);
  });
});

describe("a stream that the client abandons", () => {
  it("a disconnect while the model is working starts no further model request and runs no tool", async () => {
    let release!: (response: Response) => void;
    const gate = new Promise<Response>((resolve) => (release = resolve));
    const stub = stubProviders({
      gemini: (call) => (call.body?.tools?.[0]?.functionDeclarations ? gate : geminiText("x")(call)),
      openrouter: openRouterText("must not run"),
    });
    const infoLines: Array<{ message: string; data: Record<string, any> }> = [];
    vi.spyOn(logger, "info").mockImplementation((message: string, data?: Record<string, unknown>) => void infoLines.push({ message, data: (data ?? {}) as Record<string, any> }));
    const app = appWith({ openRouterModelCapabilities: "tools" });
    const token = await guestToken(app);
    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const client = http.request({ port, method: "POST", path: "/api/v1/orchestrator/turn-stream", headers: { "content-type": "application/json", authorization: `Bearer ${token}` } });
      client.on("error", () => {}); // destroying our own request is expected to raise ECONNRESET here
      client.end(JSON.stringify({ utterance: "explain how rivers form" }));

      await vi.waitFor(() => expect(stub.gemini).toHaveLength(1)); // the planner request is in flight
      client.destroy(); // the user pressed Stop or closed the tab
      await new Promise((resolve) => setTimeout(resolve, 50)); // let the server notice the closed connection
      release(geminiCall("web.search", { query: "rivers" })({} as never) as Response); // the model now asks for a tool
      await vi.waitFor(() => expect(infoLines.some((line) => line.message === "Turn finished")).toBe(true));

      const finished = infoLines.find((line) => line.message === "Turn finished")!.data;
      expect(finished).toMatchObject({ outcome: "cancelled", toolCalls: [], aiCalls: 1 });
      expect(stub.calls).toHaveLength(1); // no second model request, no fallback, nothing else
    } finally {
      server.close();
    }
  });
});
