import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/security/redact.js";
import { ElevenLabsTtsProvider, elevenLabsError } from "../../src/tts/elevenLabsTtsProvider.js";
import { FallbackTtsProvider } from "../../src/tts/fallbackTtsProvider.js";
import { TtsProviderError, type TtsOptions } from "../../src/tts/provider.js";
import { FakeTtsProvider, parseWav, pcmTone } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

const KEY = "sk_test_elevenlabs_0000";

async function collect(stream: AsyncIterable<Buffer>): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

/** A PCM body delivered in the given pieces (each may split a 16-bit sample). */
function pcmBody(pieces: Buffer[]): Response {
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < pieces.length) controller.enqueue(new Uint8Array(pieces[index++]!));
        else controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "audio/pcm" } },
  );
}

function voiceWith(answer: (url: string, init: RequestInit) => Response | Promise<Response>, extra: Partial<ConstructorParameters<typeof ElevenLabsTtsProvider>[0]> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const voice = new ElevenLabsTtsProvider({
    apiKey: KEY,
    voiceId: "voiceAbc12345",
    model: "eleven_flash_v2_5",
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return answer(String(url), init ?? {});
    }) as typeof fetch,
    ...extra,
  });
  return { voice, calls };
}

const failure = async (stream: AsyncIterable<Buffer>) => (await collect(stream).then(() => undefined, (error: unknown) => error)) as TtsProviderError;

describe("ElevenLabsTtsProvider", () => {
  it("asks ElevenLabs' streaming endpoint for 24 kHz PCM, with the key in a header and the configured voice and model", async () => {
    vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const { voice, calls } = voiceWith(() => pcmBody([pcmTone(0.1)]));
    await collect(voice.synthesizeStream("Hello there."));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voiceAbc12345/stream?output_format=pcm_24000");
    expect(calls[0]!.url).not.toContain(KEY);
    expect(calls[0]!.init.headers).toMatchObject({ "xi-api-key": KEY, "content-type": "application/json" });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ text: "Hello there.", model_id: "eleven_flash_v2_5" });
  });

  it("streams the PCM in order without ever splitting a 16-bit sample, and the WAV endpoint wraps the same audio", async () => {
    vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const tone = pcmTone(0.1);
    // Odd-sized pieces, as a network delivers them.
    const pieces = [tone.subarray(0, 101), tone.subarray(101, 2001), tone.subarray(2001)];
    const { voice } = voiceWith(() => pcmBody(pieces));

    const chunks = await collect(voice.synthesizeStream("Hello there."));
    expect(chunks.every((chunk) => chunk.length % 2 === 0)).toBe(true);
    expect(Buffer.concat(chunks).equals(tone)).toBe(true);

    const wav = parseWav(await voiceWith(() => pcmBody(pieces)).voice.synthesize("Hello there."));
    expect(wav).toMatchObject({ sampleRate: 24_000, channels: 1, bits: 16 });
    expect(wav.pcm.equals(tone)).toBe(true);
  });

  it("reports the voice that speaks before any sound, so the route can say ElevenLabs answered", async () => {
    vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const seen: Array<Parameters<NonNullable<TtsOptions["onResolved"]>>[0]> = [];
    const { voice } = voiceWith(() => pcmBody([pcmTone(0.05)]));
    await collect(voice.synthesizeStream("नमस्ते, आप कैसे हैं?", { onResolved: (info) => seen.push(info), voice: "hi-IN-SwaraNeural" }));
    // Another engine's voice name is ignored: the configured ElevenLabs voice speaks.
    expect(seen).toEqual([{ voice: "elevenlabs:voiceAbc12345", language: "hi", engine: "elevenlabs" }]);
  });

  it.each([
    ["a spent character quota (401 quota_exceeded)", 401, { detail: { status: "quota_exceeded", message: "You have 0 credits remaining" } }, "UNAVAILABLE", false],
    ["a rate limit (429)", 429, { detail: { status: "too_many_concurrent_requests" } }, "UNAVAILABLE", true],
    ["an outage (503)", 503, {}, "UNAVAILABLE", true],
    ["a rejected key (401)", 401, { detail: { status: "invalid_api_key" } }, "REJECTED", false],
    ["a refused request (422)", 422, { detail: [{ msg: "x" }] }, "REJECTED", false],
  ])("%s is a TtsProviderError of the right kind, with no retry here", async (_label, status, body, kind, retryable) => {
    const { voice, calls } = voiceWith(() => new Response(JSON.stringify(body), { status }));
    const error = await failure(voice.synthesizeStream("Hello there."));

    expect(error).toBeInstanceOf(TtsProviderError);
    expect(error).toMatchObject({ kind, retryable });
    expect(calls).toHaveLength(1);
  });

  it("never puts what the service said into the error message (it can quote the text)", () => {
    const error = elevenLabsError(400, JSON.stringify({ detail: { status: "bad", message: "secret user words" } }), null);
    expect(error.message).not.toContain("secret user words");
    expect(elevenLabsError(429, "", "7").retryAfterMs).toBe(7000);
  });

  it("a service that does not answer in time is a TIMEOUT; one that cannot be reached is UNAVAILABLE", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { voice } = voiceWith(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          }),
        { timeoutMs: 1000 },
      );
      const pending = failure(voice.synthesizeStream("Hello there."));
      await vi.advanceTimersByTimeAsync(1001);
      expect(await pending).toMatchObject({ kind: "TIMEOUT", retryable: true });
    } finally {
      vi.useRealTimers();
    }

    const { voice } = voiceWith(() => {
      throw new TypeError("fetch failed");
    });
    expect(await failure(voice.synthesizeStream("Hello there."))).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
  });

  it("a cancelled request is not a failure, and nothing is sent once it is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { voice, calls } = voiceWith(() => pcmBody([pcmTone(0.05)]));
    const error = await failure(voice.synthesizeStream("Hello there.", { signal: controller.signal }));
    expect(error.name).toBe("AbortError");
    expect(calls).toHaveLength(0);
  });

  it("there is nothing to ask for punctuation alone, and no key means no request", async () => {
    const { voice, calls } = voiceWith(() => pcmBody([pcmTone(0.05)]));
    expect(await failure(voice.synthesizeStream("... !!"))).toMatchObject({ kind: "INVALID_REQUEST" });

    const keyless = new ElevenLabsTtsProvider({ apiKey: () => undefined, voiceId: "voiceAbc12345", model: "m", fetchImpl: (async () => pcmBody([])) as typeof fetch });
    expect(await failure(keyless.synthesizeStream("Hello"))).toMatchObject({ kind: "REJECTED" });
    expect(calls).toHaveLength(0);
  });
});

describe("ElevenLabs as the main voice: a spent quota hands the reply to the next voice before any sound", () => {
  it("the next voice speaks the same text when ElevenLabs' credits are spent", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const { voice: elevenLabs } = voiceWith(() => new Response(JSON.stringify({ detail: { status: "quota_exceeded" } }), { status: 401 }));
    const backup = new FakeTtsProvider({ pcm: [pcmTone(0.1, 880)] });
    backup.id = "gemini";
    const chain = new FallbackTtsProvider(elevenLabs, backup);

    const spoken = Buffer.concat(await collect(chain.synthesizeStream("Hello there.")));
    expect(spoken.equals(pcmTone(0.1, 880))).toBe(true);
    expect(backup.calls).toEqual([expect.objectContaining({ kind: "stream", text: "Hello there." })]);
    expect(chain.id).toBe("elevenlabs");
  });
});
