import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import { ttsRouter } from "../../src/api/routes/tts.js";
import { buildContainer } from "../../src/container.js";
import { logger } from "../../src/security/redact.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { FallbackTtsProvider } from "../../src/tts/fallbackTtsProvider.js";
import { GeminiTtsProvider } from "../../src/tts/geminiTtsProvider.js";
import { Semaphore } from "../../src/tts/guard.js";
import { TtsProviderError, type TtsProvider } from "../../src/tts/provider.js";
import { FakeTtsProvider } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

const MB = 1024 * 1024;
const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })));
});

/** The real auth, with the voice router mounted at a short write-stall limit. */
async function listen(provider: TtsProvider, writeStallMs: number): Promise<{ port: number; token: string }> {
  const real = buildServer(buildContainer(new InMemoryStore()));
  const guest = await request(real).post("/api/v1/auth/guest").send({});
  const app = express();
  app.locals.authService = real.locals.authService;
  app.use(express.json());
  app.use("/tts", ttsRouter(provider, { writeStallMs }));
  const server = await new Promise<http.Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  servers.push(server);
  return { port: (server.address() as AddressInfo).port, token: guest.body.accessToken };
}

function startStream(port: number, token: string): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { port, host: "127.0.0.1", path: "/tts/synthesize-stream", method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` } },
      resolve,
    );
    req.on("error", reject);
    req.end(JSON.stringify({ text: "Hello there, this is a long reply." }));
  });
}

const until = async (condition: () => boolean, ms: number) => {
  const deadline = Date.now() + ms;
  while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  return condition();
};

describe("a client that stops reading the voice stream", () => {
  it("is dropped after the stall limit, and the synthesis it held is cleaned up", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    // 80 MB of audio against a client that never reads: the socket buffers fill, and "drain" never fires.
    const provider = new FakeTtsProvider({ pcm: Array.from({ length: 80 }, () => Buffer.alloc(MB)) });
    const { port, token } = await listen(provider, 300);

    const response = await startStream(port, token);
    response.pause();
    expect(response.statusCode).toBe(200);
    expect(await until(() => provider.finalized === 1, 5_000)).toBe(true);
    expect(warn).toHaveBeenCalledWith("TTS client stopped reading; dropping the response", expect.objectContaining({ stallMs: 300 }));
    response.destroy();
  });

  it("does not drop a client that is reading, however long the audio is", async () => {
    const provider = new FakeTtsProvider({ pcm: Array.from({ length: 40 }, () => Buffer.alloc(MB)) });
    const { port, token } = await listen(provider, 300);

    const response = await startStream(port, token);
    let received = 0;
    await new Promise<void>((resolve) => {
      response.on("data", (chunk: Buffer) => { received += chunk.length; });
      response.on("end", resolve);
    });
    expect(received).toBe(40 * MB);
  });
});

describe("the Gemini voice going quiet after it has started", () => {
  it("is given up on after the idle limit, and its slot comes back", async () => {
    const encoder = new TextEncoder();
    const stalled = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            const pcm = Buffer.alloc(480);
            const body = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString("base64"), mimeType: "audio/L16;codec=pcm;rate=24000" } }] } }] })}\n\n`;
            controller.enqueue(encoder.encode(body)); // one chunk, then silence: the stream never closes
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    const voice = new GeminiTtsProvider({
      apiKey: "AIza-test-key-0123456789",
      model: "gemini-3.8-flash-lite-tts",
      voice: "Kore",
      fetchImpl: (async () => stalled()) as typeof fetch,
      idleTimeoutMs: 150,
      maxConcurrent: 1,
      maxQueued: 0,
    });

    const chunks: Buffer[] = [];
    const started = Date.now();
    let failure: unknown;
    try {
      for await (const chunk of voice.synthesizeStream("Hello there")) chunks.push(chunk);
    } catch (error) {
      failure = error;
    }
    expect(chunks).toHaveLength(1);
    expect(failure).toBeInstanceOf(TtsProviderError);
    expect((failure as TtsProviderError).kind).toBe("TIMEOUT");
    expect(Date.now() - started).toBeLessThan(2_000);

    // The one slot is free again: this call is not turned away as busy.
    const again: unknown[] = [];
    try {
      for await (const chunk of voice.synthesizeStream("Hello again")) again.push(chunk);
    } catch (error) {
      expect((error as TtsProviderError).local).toBe(false);
    }
    expect(again).toHaveLength(1);
  });
});

describe("when this server is full", () => {
  it("the busy answer is marked local", async () => {
    const slots = new Semaphore(1, 0);
    await slots.acquire();
    const error = await slots.acquire().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TtsProviderError);
    expect((error as TtsProviderError).local).toBe(true);
    expect((error as TtsProviderError).kind).toBe("UNAVAILABLE");
  });

  it("the fallback voice is not asked: a crowd here is not a failure of the primary service", async () => {
    const busy = new TtsProviderError("Voice synthesis is busy; try again in a moment", "UNAVAILABLE", true, { retryAfterMs: 1000, local: true });
    const primary = new FakeTtsProvider({ error: busy });
    const secondary = new FakeTtsProvider();
    const fallback = new FallbackTtsProvider(primary, secondary);

    await expect(fallback.synthesize("Hello there")).rejects.toBe(busy);
    await expect((async () => { for await (const _ of fallback.synthesizeStream("Hello there")) { /* drain */ } })()).rejects.toBe(busy);
    expect(secondary.calls).toHaveLength(0);
  });

  it("but is still asked when the primary service itself is unavailable", async () => {
    const down = new TtsProviderError("The voice service closed the connection", "UNAVAILABLE", true);
    const secondary = new FakeTtsProvider();
    await new FallbackTtsProvider(new FakeTtsProvider({ error: down }), secondary).synthesize("Hello there");
    expect(secondary.calls).toHaveLength(1);
  });
});

describe("what the voice route writes to the log", () => {
  it("never the text a service echoed back in its error body", async () => {
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const echo = new AIProviderError(
      'Gemini voice failed: 400 Bad Request {"error":{"message":"Invalid text: my-private-spoken-sentence"}}',
      "AI_UNAVAILABLE",
      400,
      false,
    );
    const provider = new FakeTtsProvider({ error: new TtsProviderError("The Gemini voice refused this request", "REJECTED", false, { cause: echo }) });
    const app = buildServer({ ...buildContainer(new InMemoryStore()), ttsProvider: provider });
    const guest = await request(app).post("/api/v1/auth/guest").send({});
    const res = await request(app)
      .post("/api/v1/tts/synthesize")
      .set("Authorization", `Bearer ${guest.body.accessToken}`)
      .send({ text: "my-private-spoken-sentence" });
    expect(res.status).toBe(502);
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).toContain("REJECTED");
    expect(logged).not.toContain("my-private-spoken-sentence");
  });
});
