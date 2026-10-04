import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_STREAM_TEXT_CHARS, MAX_UNARY_TEXT_CHARS } from "../../src/api/routes/tts.js";
import { buildContainer } from "../../src/container.js";
import { logger } from "../../src/security/redact.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { TtsProviderError, type TtsOptions, type TtsProvider } from "../../src/tts/provider.js";
import { FakeTtsProvider, parseWav, pcmTone } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

function appWith(provider: TtsProvider | null) {
  return buildServer({ ...buildContainer(new InMemoryStore()), ttsProvider: provider });
}

async function guestToken(app: ReturnType<typeof buildServer>): Promise<string> {
  const res = await request(app).post("/api/v1/auth/guest").send({});
  expect(res.status).toBe(201);
  return res.body.accessToken;
}

const binary = (res: request.Response, callback: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
};

const post = (app: ReturnType<typeof buildServer>, path: string, token: string, body: unknown) =>
  request(app).post(path).set("Authorization", `Bearer ${token}`).buffer(true).parse(binary).send(body as object);

const json = (res: request.Response): Record<string, unknown> => JSON.parse((res.body as Buffer).toString("utf8"));

const UNARY = "/api/v1/tts/synthesize";
const STREAM = "/api/v1/tts/synthesize-stream";

describe("POST /api/v1/tts/synthesize", () => {
  it("returns a playable WAV file: 24 kHz, 16-bit, mono, the audio the voice produced", async () => {
    const tone = pcmTone(0.5);
    const app = appWith(new FakeTtsProvider({ pcm: [tone] }));
    const res = await post(app, UNARY, await guestToken(app), { text: "Hello there" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/wav");
    expect(res.headers["x-zarvis-tts"]).toBe("fake");
    const wav = parseWav(res.body as Buffer);
    expect(wav).toMatchObject({ sampleRate: 24_000, channels: 1, bits: 16 });
    expect(wav.pcm.equals(tone)).toBe(true);
  });

  it("passes the voice and the text to the provider, cutting the text to its limit", async () => {
    const provider = new FakeTtsProvider();
    const app = appWith(provider);
    await post(app, UNARY, await guestToken(app), { text: "x".repeat(MAX_UNARY_TEXT_CHARS + 500), voice: "hi-IN-MadhurNeural" });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({ kind: "unary", voice: "hi-IN-MadhurNeural" });
    expect(provider.calls[0]!.text).toHaveLength(MAX_UNARY_TEXT_CHARS);
  });

  it("requires a signed-in account, and a text", async () => {
    const provider = new FakeTtsProvider();
    const app = appWith(provider);
    expect((await request(app).post(UNARY).send({ text: "hi" })).status).toBe(401);
    expect((await request(app).post(UNARY).set("Authorization", "Bearer nonsense").send({ text: "hi" })).status).toBe(401);
    const token = await guestToken(app);
    for (const body of [{}, { text: "" }, { text: "   " }, { text: 42 }, { text: ["a"] }, { voice: "Kore" }]) {
      const res = await post(app, UNARY, token, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(json(res)).toEqual({ error: "text is required" });
    }
    expect(provider.calls).toHaveLength(0);
  });

  it("says plainly that spoken replies are off when there is no provider (TTS_PROVIDER=none)", async () => {
    const app = appWith(null);
    const res = await post(app, UNARY, await guestToken(app), { text: "hi" });
    expect(res.status).toBe(503);
    expect(json(res)).toMatchObject({ code: "tts_disabled" });
  });

  it("maps each kind of failure to an honest status and code, and never forwards what the service said", async () => {
    const cases: Array<[TtsProviderError | Error, number, string, boolean | undefined]> = [
      [new TtsProviderError("secret internal detail", "INVALID_REQUEST", false), 400, "tts_invalid_request", undefined],
      [new TtsProviderError("secret internal detail", "TIMEOUT", true), 504, "tts_timeout", true],
      [new TtsProviderError("secret internal detail", "UNAVAILABLE", true), 503, "tts_unavailable", true],
      [new TtsProviderError("secret internal detail", "REJECTED", false), 502, "tts_failed", false],
      [new TtsProviderError("secret internal detail", "NO_AUDIO", false), 502, "tts_failed", false],
      [new TtsProviderError("secret internal detail", "BAD_AUDIO", false), 502, "tts_failed", false],
      [new Error("secret internal detail"), 502, "tts_failed", true],
    ];
    for (const [error, status, code, retryable] of cases) {
      const app = appWith(new FakeTtsProvider({ error }));
      const res = await post(app, UNARY, await guestToken(app), { text: "hi" });
      expect(res.status, code + " " + (error as TtsProviderError).kind).toBe(status);
      const body = json(res);
      expect(body.code).toBe(code);
      if (retryable !== undefined) expect(body.retryable).toBe(retryable);
      expect(JSON.stringify(body)).not.toContain("secret internal detail");
    }
  });

  it("logs what stopped the voice, down to the system error under it, and never the text that was to be spoken", async () => {
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const failure = new TtsProviderError("The audio decoder could not start", "BAD_AUDIO", false, { cause: new Error("Cannot use import statement outside a module") });
    const app = appWith(new FakeTtsProvider({ error: failure }));
    await post(app, UNARY, await guestToken(app), { text: "my password is swordfish" });
    expect(errorLog).toHaveBeenCalledWith("TTS synthesis failed", {
      kind: "BAD_AUDIO",
      error: "The audio decoder could not start",
      cause: "Cannot use import statement outside a module",
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("swordfish");
  });

  it("tells a client when to come back, if the voice said so", async () => {
    const app = appWith(new FakeTtsProvider({ error: new TtsProviderError("busy", "UNAVAILABLE", true, { retryAfterMs: 12_300 }) }));
    const res = await post(app, UNARY, await guestToken(app), { text: "hi" });
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("13");
  });

  it("stops the voice when the client goes away, and does not call that a failure", async () => {
    const provider = new FakeTtsProvider({ hang: true });
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const app = appWith(provider);
    const token = await guestToken(app);
    const server = app.listen(0);
    try {
      const client = http.request({ port: (server.address() as AddressInfo).port, method: "POST", path: UNARY, headers: { "content-type": "application/json", authorization: `Bearer ${token}` } });
      client.on("error", () => undefined);
      client.end(JSON.stringify({ text: "hello" }));
      await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
      client.destroy();
      await vi.waitFor(() => expect(provider.calls[0]!.signal?.aborted).toBe(true));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });
});

describe("POST /api/v1/tts/synthesize-stream", () => {
  it("streams headerless 24 kHz 16-bit mono PCM, named as the engine's stream", async () => {
    const chunks = [pcmTone(0.1, 300), pcmTone(0.1, 500), pcmTone(0.1, 700)];
    const app = appWith(new FakeTtsProvider({ pcm: chunks }));
    const res = await post(app, STREAM, await guestToken(app), { text: "Hello there" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/l16; codec=pcm; rate=24000");
    expect(res.headers["x-zarvis-tts"]).toBe("fake-stream");
    expect(res.headers["cache-control"]).toBe("no-cache, no-transform");
    const body = res.body as Buffer;
    expect(body.length % 2).toBe(0);
    expect(body.subarray(0, 4).toString("ascii")).not.toBe("RIFF"); // no header: the client schedules raw samples
    expect(body.equals(Buffer.concat(chunks))).toBe(true);
  });

  it("keeps the audio in the order it was produced, however many chunks there are", async () => {
    const chunks = Array.from({ length: 60 }, (_, i) => Buffer.alloc(2000, i + 1));
    const app = appWith(new FakeTtsProvider({ pcm: chunks }));
    const res = await post(app, STREAM, await guestToken(app), { text: "a long reply" });
    expect((res.body as Buffer).equals(Buffer.concat(chunks))).toBe(true);
  });

  it("passes the voice and text on, cutting the text to its limit", async () => {
    const provider = new FakeTtsProvider();
    const app = appWith(provider);
    await post(app, STREAM, await guestToken(app), { text: "x".repeat(MAX_STREAM_TEXT_CHARS + 300), voice: "Puck" });
    expect(provider.calls[0]).toMatchObject({ kind: "stream", voice: "Puck" });
    expect(provider.calls[0]!.text).toHaveLength(MAX_STREAM_TEXT_CHARS);
  });

  it("requires a signed-in account, and a text", async () => {
    const provider = new FakeTtsProvider();
    const app = appWith(provider);
    expect((await request(app).post(STREAM).send({ text: "hi" })).status).toBe(401);
    const token = await guestToken(app);
    for (const body of [{}, { text: "" }, { text: " \n " }, { text: 7 }]) expect((await post(app, STREAM, token, body)).status).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });

  it("says plainly that spoken replies are off when there is no provider", async () => {
    const app = appWith(null);
    const res = await post(app, STREAM, await guestToken(app), { text: "hi" });
    expect(res.status).toBe(503);
    expect(json(res)).toMatchObject({ code: "tts_disabled" });
  });

  it("answers with a real HTTP error, not a broken audio stream, when the voice fails before any sound", async () => {
    for (const [error, status] of [
      [new TtsProviderError("x", "UNAVAILABLE", true), 503],
      [new TtsProviderError("x", "TIMEOUT", true), 504],
      [new TtsProviderError("x", "INVALID_REQUEST", false), 400],
      [new TtsProviderError("x", "BAD_AUDIO", false), 502],
      [new Error("x"), 502],
    ] as const) {
      const app = appWith(new FakeTtsProvider({ error }));
      const res = await post(app, STREAM, await guestToken(app), { text: "hi" });
      expect(res.status).toBe(status);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    }
  });

  it("answers 502 for a voice that finishes without saying anything", async () => {
    const app = appWith(new FakeTtsProvider({ pcm: [] }));
    const res = await post(app, STREAM, await guestToken(app), { text: "hi" });
    expect(res.status).toBe(502);
    expect(json(res)).toMatchObject({ code: "tts_failed", retryable: true });
  });

  it("ends the audio cleanly, with no error body, when the voice fails after sound has started", async () => {
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const chunks = [pcmTone(0.1), pcmTone(0.1), pcmTone(0.1)];
    const app = appWith(new FakeTtsProvider({ pcm: chunks, error: new TtsProviderError("dropped", "UNAVAILABLE", true), errorAfter: 2 }));
    const res = await post(app, STREAM, await guestToken(app), { text: "hi" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/l16; codec=pcm; rate=24000");
    expect((res.body as Buffer).equals(Buffer.concat(chunks.slice(0, 2)))).toBe(true);
    expect(errorLog).toHaveBeenCalledWith("TTS stream interrupted after audio started", expect.objectContaining({ kind: "UNAVAILABLE" }));
  });

  it("stops the voice when the client goes away mid-stream, and does not call that a failure", async () => {
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const provider = new FakeTtsProvider({ pcm: Array.from({ length: 200 }, () => Buffer.alloc(4000, 1)), delayMs: 10 });
    const app = appWith(provider);
    const token = await guestToken(app);
    const server = app.listen(0);
    try {
      const received = await new Promise<number>((resolve, reject) => {
        const client = http.request({ port: (server.address() as AddressInfo).port, method: "POST", path: STREAM, headers: { "content-type": "application/json", authorization: `Bearer ${token}` } });
        let bytes = 0;
        client.on("response", (res) => {
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes >= 8000) client.destroy(); // Stop pressed after two chunks
          });
        });
        client.on("error", () => resolve(bytes));
        client.on("close", () => resolve(bytes));
        client.on("timeout", () => reject(new Error("timeout")));
        client.end(JSON.stringify({ text: "hello" }));
      });
      expect(received).toBeGreaterThanOrEqual(8000);
      await vi.waitFor(() => expect(provider.finalized).toBe(1));
      expect(provider.calls[0]!.signal?.aborted).toBe(true);
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it("delivers everything, in order, to a client that reads slowly (backpressure)", async () => {
    const chunks = Array.from({ length: 80 }, (_, i) => Buffer.alloc(64 * 1024, (i % 250) + 1));
    const app = appWith(new FakeTtsProvider({ pcm: chunks }));
    const token = await guestToken(app);
    const server = app.listen(0);
    try {
      const body = await new Promise<Buffer>((resolve, reject) => {
        const client = http.request({ port: (server.address() as AddressInfo).port, method: "POST", path: STREAM, headers: { "content-type": "application/json", authorization: `Bearer ${token}` } });
        client.on("error", reject);
        client.on("response", (res) => {
          const parts: Buffer[] = [];
          res.on("data", (chunk: Buffer) => parts.push(chunk));
          res.on("end", () => resolve(Buffer.concat(parts)));
          res.pause();
          setTimeout(() => res.resume(), 150); // the client is busy for a moment: the server must wait, not drop
        });
        client.end(JSON.stringify({ text: "hello" }));
      });
      expect(body.equals(Buffer.concat(chunks))).toBe(true);
    } finally {
      server.close();
    }
  });

  it("keeps simultaneous replies apart: each stream carries only its own audio", async () => {
    const provider: TtsProvider = {
      id: "fake",
      getDefaultVoice: () => "v",
      async synthesize() {
        return Buffer.alloc(0);
      },
      async *synthesizeStream(text: string, _options?: TtsOptions) {
        const marker = text.startsWith("one") ? 1 : text.startsWith("two") ? 2 : 3;
        for (let i = 0; i < 20; i += 1) {
          yield Buffer.alloc(800, marker);
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 4));
        }
      },
    };
    const app = appWith(provider);
    const token = await guestToken(app);
    const results = await Promise.all(["one", "two", "three", "one again", "two again"].map((text) => post(app, STREAM, token, { text })));
    expect(results.map((res) => new Set(res.body as Buffer).size)).toEqual([1, 1, 1, 1, 1]);
    expect(results.map((res) => (res.body as Buffer)[0])).toEqual([1, 2, 3, 1, 2]);
    for (const res of results) expect((res.body as Buffer).length).toBe(16_000);
  });
});

describe("the rate limit", () => {
  it("allows 40 requests a minute per account, shared by both endpoints, and then says 429 with when to retry", async () => {
    const provider = new FakeTtsProvider();
    const app = appWith(provider);
    const token = await guestToken(app);
    for (let i = 0; i < 40; i += 1) {
      const res = await post(app, i % 2 ? STREAM : UNARY, token, { text: `sentence ${i}` });
      expect(res.status, `request ${i + 1}`).toBe(200);
    }
    for (const path of [UNARY, STREAM]) {
      const res = await post(app, path, token, { text: "one too many" });
      expect(res.status).toBe(429);
      expect(json(res)).toMatchObject({ code: "rate_limited" });
      expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    }
    expect(provider.calls).toHaveLength(40); // the limited ones never reached the voice
  });

  it("counts each account on its own", async () => {
    const app = appWith(new FakeTtsProvider());
    const first = await guestToken(app);
    const second = await guestToken(app);
    for (let i = 0; i < 40; i += 1) await post(app, UNARY, first, { text: "hi" });
    expect((await post(app, UNARY, first, { text: "hi" })).status).toBe(429);
    expect((await post(app, UNARY, second, { text: "hi" })).status).toBe(200);
  });

  it("counts requests that fail too: a broken voice is not an open door", async () => {
    const app = appWith(new FakeTtsProvider({ error: new TtsProviderError("x", "UNAVAILABLE", true) }));
    const token = await guestToken(app);
    for (let i = 0; i < 40; i += 1) expect((await post(app, UNARY, token, { text: "hi" })).status).toBe(503);
    expect((await post(app, UNARY, token, { text: "hi" })).status).toBe(429);
  });
});

describe("a voice that fails never takes the reply with it", () => {
  it("lets the turn finish, the voice fail, and the next turn finish", async () => {
    const app = appWith(new FakeTtsProvider({ error: new TtsProviderError("x", "UNAVAILABLE", true) }));
    const token = await guestToken(app);
    const turn = (utterance: string) => request(app).post("/api/v1/orchestrator/turn").set("Authorization", `Bearer ${token}`).send({ utterance });

    const first = await turn("hello zarvis");
    expect(first.status).toBe(200);
    expect(typeof first.body.message).toBe("string");
    expect(first.body.message.length).toBeGreaterThan(0);

    const voice = await post(app, STREAM, token, { text: first.body.message });
    expect(voice.status).toBe(503);

    const second = await turn("what can you do");
    expect(second.status).toBe(200);
    expect(second.body.message.length).toBeGreaterThan(0);
  });

  it("lets the streamed turn finish while its voice is broken", async () => {
    const provider = new FakeTtsProvider({ error: new TtsProviderError("x", "UNAVAILABLE", true) });
    const app = appWith(provider);
    const token = await guestToken(app);
    const res = await request(app).post("/api/v1/orchestrator/turn-stream").set("Authorization", `Bearer ${token}`).send({ utterance: "hello zarvis" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("event: done");
    expect(provider.calls).toHaveLength(0); // the turn itself never asks for speech
  });
});
