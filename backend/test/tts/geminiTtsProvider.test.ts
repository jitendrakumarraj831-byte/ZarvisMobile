import { afterEach, describe, expect, it, vi } from "vitest";
import { retryDelayMs as sharedRetryPolicy } from "../../src/ai/geminiErrors.js";
import { logger } from "../../src/security/redact.js";
import { GeminiTtsProvider, geminiVoiceLabel } from "../../src/tts/geminiTtsProvider.js";
import { TtsProviderError, type TtsOptions } from "../../src/tts/provider.js";
import { parseWav, pcmTone } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

const KEY = "AIza-test-key-must-never-leak-0123456789";
const PCM_MIME = "audio/L16;codec=pcm;rate=24000";

/** One SSE event carrying one inline audio part. */
const event = (pcm: Buffer, mimeType = PCM_MIME) =>
  `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString("base64"), mimeType } }] } }] })}\n\n`;

function sseResponse(body: string | string[], init: ResponseInit = { status: 200 }): Response {
  const parts = Array.isArray(body) ? body : [body];
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" }, ...init },
  );
}

const dailyQuota = JSON.stringify({
  error: { details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }] }] },
});

type FetchCall = { url: string; init: RequestInit };

function voiceWith(responses: Array<Response | Error | (() => Response | Promise<Response>)>, options: Partial<ConstructorParameters<typeof GeminiTtsProvider>[0]> = {}) {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next.clone();
  }) as typeof fetch;
  const voice = new GeminiTtsProvider({
    apiKey: KEY,
    model: "gemini-3.8-flash-lite-tts",
    voice: "Kore",
    fetchImpl,
    // The shared policy decides WHETHER to retry (that is under test here); only its waiting is removed, so the tests do not sleep.
    retryDelayMs: (failure, attempt) => (sharedRetryPolicy(failure, attempt) === null ? null : 0),
    ...options,
  });
  return { voice, calls };
}

async function collect(stream: AsyncIterable<Buffer>): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

describe("GeminiTtsProvider: the request", () => {
  it("asks the streaming method of the configured model for audio in the chosen prebuilt voice, with the key in a header only", async () => {
    const { voice, calls } = voiceWith([sseResponse(event(pcmTone(0.1)))]);
    await collect(voice.synthesizeStream("Hello there"));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:streamGenerateContent?alt=sse");
    expect(calls[0]!.url).not.toContain(KEY);
    expect(calls[0]!.init.headers).toMatchObject({ "x-goog-api-key": KEY, "content-type": "application/json" });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      contents: [{ role: "user", parts: [{ text: "Hello there" }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } },
    });
  });

  it("reads the key when a request is made, so a rotated key is used", async () => {
    let key: string | undefined = "first";
    const { voice, calls } = voiceWith([sseResponse(event(pcmTone(0.05)))], { apiKey: () => key });
    await collect(voice.synthesizeStream("one"));
    key = "second";
    await collect(voice.synthesizeStream("two"));
    expect(calls.map((call) => (call.init.headers as Record<string, string>)["x-goog-api-key"])).toEqual(["first", "second"]);
  });

  it("sends the speakable text (no markdown), cut to the limit, and no request when there is nothing to say", async () => {
    const { voice, calls } = voiceWith([sseResponse(event(pcmTone(0.05)))], { maxTextChars: 20 });
    await collect(voice.synthesizeStream("**Hello** `world`, this is a long reply that goes on"));
    expect(JSON.parse(calls[0]!.init.body as string).contents[0].parts[0].text.length).toBeLessThanOrEqual(20);
    expect(JSON.parse(calls[0]!.init.body as string).contents[0].parts[0].text).not.toContain("**");

    for (const empty of ["", "   ", "🙂🙂", "...", 42 as unknown as string]) {
      await expect(collect(voice.synthesizeStream(empty))).rejects.toMatchObject({ kind: "INVALID_REQUEST" });
    }
    expect(calls).toHaveLength(1);
  });

  it("uses the voice the caller names if Gemini has it, and ignores an Edge voice name or anything else", async () => {
    const { voice, calls } = voiceWith([sseResponse(event(pcmTone(0.05)))]);
    const spoken = (index: number) => JSON.parse(calls[index]!.init.body as string).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName;
    await collect(voice.synthesizeStream("Hello", { voice: "Puck" }));
    await collect(voice.synthesizeStream("Hello", { voice: "hi-IN-SwaraNeural" }));
    await collect(voice.synthesizeStream("Hello", { voice: { evil: true } }));
    expect([spoken(0), spoken(1), spoken(2)]).toEqual(["Puck", "Kore", "Kore"]);
  });

  it("reports which voice will speak, labelled so it can never be taken for an Edge voice", async () => {
    const seen: Array<Parameters<NonNullable<TtsOptions["onResolved"]>>[0]> = [];
    const { voice } = voiceWith([sseResponse(event(pcmTone(0.05)))]);
    await collect(voice.synthesizeStream("Hello", { onResolved: (info) => seen.push(info) }));
    await collect(voice.synthesizeStream("नमस्ते, आप कैसे हैं", { onResolved: (info) => seen.push(info) }));
    expect(seen).toEqual([
      { voice: "gemini:Kore", language: "en", engine: "gemini" },
      { voice: "gemini:Kore", language: "hi", engine: "gemini" },
    ]);
    expect(voice.getDefaultVoice()).toBe(geminiVoiceLabel("Kore"));
    expect(voice.id).toBe("gemini");
  });
});

describe("GeminiTtsProvider: the audio", () => {
  it("streams the PCM in order and the unary call is the same audio with a 24 kHz 16-bit mono WAV header", async () => {
    const first = pcmTone(0.2, 440);
    const second = pcmTone(0.2, 880);
    const { voice } = voiceWith([sseResponse([event(first), event(second)])]);
    expect(Buffer.concat(await collect(voice.synthesizeStream("Hello"))).equals(Buffer.concat([first, second]))).toBe(true);
    const wav = parseWav(await voice.synthesize("Hello"));
    expect(wav).toMatchObject({ sampleRate: 24_000, channels: 1, bits: 16 });
    expect(wav.pcm.equals(Buffer.concat([first, second]))).toBe(true);
  });

  it("reads an SSE event that arrives in pieces, and ignores comments and [DONE]", async () => {
    const pcm = pcmTone(0.1);
    const whole = event(pcm);
    const { voice } = voiceWith([sseResponse([": keep-alive\n\n", whole.slice(0, 30), whole.slice(30, 90), whole.slice(90), "data: [DONE]\n\n"])]);
    expect(Buffer.concat(await collect(voice.synthesizeStream("Hello"))).equals(pcm)).toBe(true);
  });

  it("never splits a 16-bit sample between two chunks, and loses no byte doing it", async () => {
    const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const { voice } = voiceWith([sseResponse([event(pcm.subarray(0, 3)), event(pcm.subarray(3, 8))])]);
    const chunks = await collect(voice.synthesizeStream("Hello"));
    expect(chunks.every((chunk) => chunk.length % 2 === 0)).toBe(true);
    expect(Buffer.concat(chunks).equals(pcm)).toBe(true);
  });

  it("refuses audio at another sample rate instead of playing it at the wrong speed", async () => {
    const { voice } = voiceWith([sseResponse(event(pcmTone(0.1), "audio/L16;codec=pcm;rate=16000"))]);
    await expect(collect(voice.synthesizeStream("Hello"))).rejects.toMatchObject({ kind: "BAD_AUDIO" });
  });

  it("says so when Gemini finishes without any audio, or sends something that is not JSON", async () => {
    await expect(collect(voiceWith([sseResponse(`data: ${JSON.stringify({ candidates: [] })}\n\n`)]).voice.synthesizeStream("Hello"))).rejects.toMatchObject({ kind: "NO_AUDIO" });
    await expect(voiceWith([sseResponse(`data: ${JSON.stringify({ candidates: [] })}\n\n`)]).voice.synthesize("Hello")).rejects.toMatchObject({ kind: "NO_AUDIO" });
    await expect(collect(voiceWith([sseResponse("data: {not json\n\n")]).voice.synthesizeStream("Hello"))).rejects.toMatchObject({ kind: "BAD_AUDIO" });
  });
});

describe("GeminiTtsProvider: failures, named for the voice boundary", () => {
  it("does not retry a refusal (400, 401, 403), calls it REJECTED, and never puts the key or Google's words in the message", async () => {
    for (const status of [400, 401, 403]) {
      const { voice, calls } = voiceWith([new Response(`API key ${KEY} is invalid`, { status, statusText: "Nope" })]);
      const error = await collect(voice.synthesizeStream("Hello")).then(() => undefined, (e: unknown) => e as TtsProviderError);
      expect(error).toBeInstanceOf(TtsProviderError);
      expect(error).toMatchObject({ kind: "REJECTED", retryable: false });
      expect(error!.message).not.toContain(KEY);
      expect(error!.message).not.toContain("invalid");
      expect(calls).toHaveLength(1);
    }
  });

  it("retries a temporary 503 and succeeds; if it never recovers it is UNAVAILABLE and retryable", async () => {
    const pcm = pcmTone(0.1);
    const recovering = voiceWith([new Response("busy", { status: 503 }), new Response("busy", { status: 503 }), sseResponse(event(pcm))]);
    expect(Buffer.concat(await collect(recovering.voice.synthesizeStream("Hello"))).equals(pcm)).toBe(true);
    expect(recovering.calls).toHaveLength(3);

    const down = voiceWith([new Response("busy", { status: 503 })]);
    await expect(collect(down.voice.synthesizeStream("Hello"))).rejects.toMatchObject({ kind: "UNAVAILABLE", retryable: true });
  });

  it("moves to the next TTS model when one model's daily quota is spent, and starts again on the same text", async () => {
    const pcm = pcmTone(0.1);
    const { voice, calls } = voiceWith([new Response(dailyQuota, { status: 429 }), sseResponse(event(pcm))]);
    expect(Buffer.concat(await collect(voice.synthesizeStream("Hello"))).equals(pcm)).toBe(true);
    expect(calls.map((call) => call.url.match(/models\/([^:]+):/)![1])).toEqual(["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"]);
  });

  it("when every model's quota is spent it is UNAVAILABLE and not retryable (it cannot recover within a request)", async () => {
    const { voice, calls } = voiceWith([new Response(dailyQuota, { status: 429 })]);
    await expect(collect(voice.synthesizeStream("Hello"))).rejects.toMatchObject({ kind: "UNAVAILABLE", retryable: false });
    expect(calls.length).toBe(2); // the configured model and the one other known TTS model
  });

  it("moves past a model that does not exist, but gives up on a refusal from the next one", async () => {
    const { voice, calls } = voiceWith([new Response("no such model", { status: 404 }), new Response("bad", { status: 400 })], { model: "custom-tts" });
    await expect(collect(voice.synthesizeStream("Hello"))).rejects.toMatchObject({ kind: "REJECTED" });
    expect(calls).toHaveLength(2);
  });

  it("a network failure is UNAVAILABLE and retryable; a Gemini that does not answer in time is a TIMEOUT", async () => {
    const offline = voiceWith([new TypeError("fetch failed")]);
    await expect(collect(offline.voice.synthesizeStream("Hello"))).rejects.toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    expect(offline.calls).toHaveLength(3); // tried, retried twice, and no other model is nearer than this one when the network is down

    // A fetch that honours its signal, as the real one does: the provider's own timeout is what ends it.
    const withSignal = new GeminiTtsProvider({
      apiKey: KEY,
      model: "m",
      voice: "Kore",
      timeoutMs: 15,
      retryDelayMs: () => null,
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }))) as unknown as typeof fetch,
    });
    await expect(collect(withSignal.synthesizeStream("Hello"))).rejects.toMatchObject({ kind: "TIMEOUT" });
  });

  it("will not even ask without a key, and says why", async () => {
    const { voice, calls } = voiceWith([sseResponse(event(pcmTone(0.05)))], { apiKey: undefined });
    await expect(collect(voice.synthesizeStream("Hello"))).rejects.toMatchObject({ kind: "REJECTED", retryable: false });
    expect(calls).toHaveLength(0);
  });
});

describe("GeminiTtsProvider: cancelling", () => {
  it("a cancelled request is an AbortError, not a failure, and the upstream response is cancelled", async () => {
    let upstreamCancelled = false;
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(encoder.encode(event(pcmTone(0.05))));
          return new Promise((resolve) => setTimeout(resolve, 5));
        },
        cancel() {
          upstreamCancelled = true;
        },
      }),
      { status: 200 },
    );
    const { voice } = voiceWith([() => response]);
    const controller = new AbortController();
    let chunks = 0;
    await expect(
      (async () => {
        for await (const _chunk of voice.synthesizeStream("A long reply", { signal: controller.signal })) {
          chunks += 1;
          if (chunks === 2) controller.abort();
        }
      })(),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(upstreamCancelled).toBe(true);
  });

  it("an already cancelled request sends nothing", async () => {
    const { voice, calls } = voiceWith([sseResponse(event(pcmTone(0.05)))]);
    const controller = new AbortController();
    controller.abort();
    await expect(collect(voice.synthesizeStream("Hello", { signal: controller.signal }))).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(0);
  });

  it("stopping early (the listener went away) cancels the upstream response too", async () => {
    let upstreamCancelled = false;
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < 5; i += 1) controller.enqueue(encoder.encode(event(pcmTone(0.05))));
        },
        cancel() {
          upstreamCancelled = true;
        },
      }),
      { status: 200 },
    );
    const { voice } = voiceWith([() => response]);
    for await (const _chunk of voice.synthesizeStream("Hello")) break;
    expect(upstreamCancelled).toBe(true);
  });
});

describe("GeminiTtsProvider: what it logs", () => {
  it("logs the engine, voice, model and sizes of a call, never the text or the key", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const { voice } = voiceWith([sseResponse(event(pcmTone(0.1)))]);
    await collect(voice.synthesizeStream("My private sentence"));
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain('"engine":"gemini"');
    expect(logged).toContain("gemini-3.8-flash-lite-tts");
    expect(logged).not.toContain("private");
    expect(logged).not.toContain(KEY);
  });
});
