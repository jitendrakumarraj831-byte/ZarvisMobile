import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTtsProvider, resolveTtsConfig } from "../../src/config/ttsConfig.js";
import { KeyRotator } from "../../src/security/keyRotator.js";
import { logger } from "../../src/security/redact.js";
import { ElevenLabsTtsProvider, elevenLabsError } from "../../src/tts/elevenLabsTtsProvider.js";
import { FallbackTtsProvider } from "../../src/tts/fallbackTtsProvider.js";
import { KeyRotatingTtsProvider } from "../../src/tts/keyRotatingTtsProvider.js";
import { TtsProviderError } from "../../src/tts/provider.js";
import { FakeTtsProvider, parseWav, pcmTone } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

const KEYS = ["sk_test_elevenlabs_AAAA1111", "sk_test_elevenlabs_BBBB2222", "sk_test_elevenlabs_CCCC3333"];

async function collect(stream: AsyncIterable<Buffer>): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

const pcm = (pieces: Buffer[]) => {
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
};
const refusal = (status: number, detailStatus?: string) => new Response(JSON.stringify({ detail: { status: detailStatus ?? "x", message: "the user's words" } }), { status });

/** ElevenLabs voices (the real provider), one per key, answering per key from `answers`. */
function rotatingVoice(answers: Record<string, () => Response>, keys = KEYS) {
  const calls: string[] = [];
  const rotator = new KeyRotator({ name: "ELEVENLABS", keys: () => keys });
  const voice = new KeyRotatingTtsProvider({
    id: "elevenlabs",
    rotator,
    build: (key) =>
      new ElevenLabsTtsProvider({
        apiKey: key,
        voiceId: "voiceAbc12345",
        model: "eleven_flash_v2_5",
        fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
          const used = (init?.headers as Record<string, string>)["xi-api-key"]!;
          calls.push(used);
          return (answers[used] ?? (() => refusal(500)))();
        }) as typeof fetch,
      }),
  });
  return { voice, calls, rotator };
}

describe("elevenLabsError: which refusals are about the key", () => {
  it.each([
    ["a spent character quota (401 quota_exceeded)", 401, "quota_exceeded", "quota_exhausted"],
    ["no credit (402)", 402, undefined, "quota_exhausted"],
    ["a rate or concurrency limit (429)", 429, "too_many_concurrent_requests", "rate_limited"],
    ["a rejected key (401)", 401, "invalid_api_key", "auth_rejected"],
    ["a refused account (403)", 403, "detected_unusual_activity", "auth_rejected"],
  ] as const)("%s → %s", (_label, status, detail, keyFailure) => {
    expect(elevenLabsError(status, JSON.stringify({ detail: { status: detail } }), null).keyFailure).toBe(keyFailure);
  });

  it.each([
    ["ElevenLabs overloaded as a whole (429 system_busy)", 429, "system_busy"],
    ["an outage (503)", 503, undefined],
    ["a refused request (422)", 422, undefined],
    ["an unknown voice (404)", 404, "voice_not_found"],
  ] as const)("%s is the same for every key", (_label, status, detail) => {
    expect(elevenLabsError(status, JSON.stringify({ detail: { status: detail } }), null).keyFailure).toBeUndefined();
  });
});

describe("KeyRotatingTtsProvider", () => {
  it("a key out of characters hands the sentence to the next key before any sound, and later sentences start there", async () => {
    vi.spyOn(logger, "info").mockImplementation(() => undefined);
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const tone = pcmTone(0.1);
    const { voice, calls, rotator } = rotatingVoice({ [KEYS[0]!]: () => refusal(401, "quota_exceeded"), [KEYS[1]!]: () => pcm([tone]) });

    expect(Buffer.concat(await collect(voice.synthesizeStream("Hello there."))).equals(tone)).toBe(true);
    expect(calls).toEqual([KEYS[0], KEYS[1]]);

    await collect(voice.synthesizeStream("And again."));
    expect(calls.slice(2)).toEqual([KEYS[1]]);
    expect(rotator.status()).toMatchObject({ activeSlot: 2, rotations: 1 });
    expect(rotator.status().slots[0]).toMatchObject({ state: "cooling", reason: "quota_exhausted" });
  });

  it("the rotation is recorded at the first sound, even when the listener stops mid-sentence", async () => {
    vi.spyOn(logger, "info").mockImplementation(() => undefined);
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const tone = pcmTone(0.2);
    const { voice, rotator } = rotatingVoice({ [KEYS[0]!]: () => refusal(429), [KEYS[1]!]: () => pcm([tone.subarray(0, 2000), tone.subarray(2000)]) });
    for await (const _chunk of voice.synthesizeStream("Hello there.")) break;
    expect(rotator.status()).toMatchObject({ activeSlot: 2, rotations: 1 });
  });

  it("a rate-limited key and a rejected key are both skipped, in order", async () => {
    vi.spyOn(logger, "info").mockImplementation(() => undefined);
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const { voice, calls } = rotatingVoice({ [KEYS[0]!]: () => refusal(429), [KEYS[1]!]: () => refusal(401, "invalid_api_key"), [KEYS[2]!]: () => pcm([pcmTone(0.05)]) });
    await collect(voice.synthesizeStream("Hello."));
    expect(calls).toEqual(KEYS);
  });

  it("an outage is the same for every key: the failure leaves at once, for the next voice in the chain", async () => {
    const { voice, calls } = rotatingVoice({ [KEYS[0]!]: () => refusal(503) });
    const failure = await collect(voice.synthesizeStream("Hello.")).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TtsProviderError);
    expect((failure as TtsProviderError).kind).toBe("UNAVAILABLE");
    expect(calls).toEqual([KEYS[0]]);
  });

  it("when every key is refused, the last refusal reaches the chain, so the next voice speaks", async () => {
    vi.spyOn(logger, "info").mockImplementation(() => undefined);
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const spent = () => refusal(401, "quota_exceeded");
    const { voice, calls } = rotatingVoice({ [KEYS[0]!]: spent, [KEYS[1]!]: spent, [KEYS[2]!]: spent });
    const edge = new FakeTtsProvider();
    const chain = new FallbackTtsProvider(voice, edge);

    const audio = await collect(chain.synthesizeStream("Hello."));
    expect(audio.length).toBeGreaterThan(0);
    expect(calls).toEqual(KEYS);
    expect(edge.calls).toHaveLength(1);
  });

  it("once sound has started, a failure is not restarted with another key", async () => {
    let first = true;
    const broken = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (first) {
              first = false;
              controller.enqueue(new Uint8Array(pcmTone(0.05)));
            } else controller.error(new Error("socket hang up"));
          },
        }),
        { status: 200 },
      );
    const { voice, calls } = rotatingVoice({ [KEYS[0]!]: broken, [KEYS[1]!]: () => pcm([pcmTone(0.05)]) });
    const chunks: Buffer[] = [];
    const failure = await (async () => {
      for await (const chunk of voice.synthesizeStream("Hello.")) chunks.push(chunk);
    })().catch((error: unknown) => error);
    expect(chunks.length).toBeGreaterThan(0);
    expect(failure).toBeInstanceOf(TtsProviderError);
    expect(calls).toEqual([KEYS[0]]);
  });

  it("the WAV endpoint rotates the same way and returns one whole file", async () => {
    vi.spyOn(logger, "info").mockImplementation(() => undefined);
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const tone = pcmTone(0.1);
    const { voice, calls } = rotatingVoice({ [KEYS[0]!]: () => refusal(429), [KEYS[1]!]: () => pcm([tone]) });
    const wav = parseWav(await voice.synthesize("Hello there."));
    expect(wav.pcm.equals(tone)).toBe(true);
    expect(calls).toEqual([KEYS[0], KEYS[1]]);
  });

  it("a cancelled sentence is never a reason to try another key", async () => {
    const controller = new AbortController();
    const { voice, calls } = rotatingVoice({
      [KEYS[0]!]: () => {
        controller.abort();
        return refusal(429);
      },
    });
    const failure = await collect(voice.synthesizeStream("Hello.", { signal: controller.signal })).catch((error: unknown) => error);
    // The error leaves as it is (as FallbackTtsProvider does on a cancel); no second key is asked.
    expect(failure).toBeInstanceOf(Error);
    expect(calls).toEqual([KEYS[0]]);
  });

  it("never logs a key", async () => {
    const lines: string[] = [];
    vi.spyOn(logger, "warn").mockImplementation((message, data) => void lines.push(JSON.stringify({ message, data })));
    vi.spyOn(logger, "info").mockImplementation((message, data) => void lines.push(JSON.stringify({ message, data })));
    const { voice } = rotatingVoice({ [KEYS[0]!]: () => refusal(429), [KEYS[1]!]: () => pcm([pcmTone(0.05)]) });
    await collect(voice.synthesizeStream("Hello."));
    expect(lines.join("\n")).toContain("API key rotated");
    for (const key of KEYS) expect(lines.join("\n")).not.toContain(key);
  });
});

describe("ElevenLabs first, with several keys", () => {
  it("speaks first by default once it has a key, with Gemini then Edge behind it; without one, Gemini stays first", () => {
    expect(resolveTtsConfig({ elevenLabsKeys: [KEYS[0]!] })).toMatchObject({ provider: "elevenlabs", fallbacks: ["gemini", "edge"] });
    expect(resolveTtsConfig({ elevenLabsApiKey: KEYS[0] })).toMatchObject({ provider: "elevenlabs" });
    expect(resolveTtsConfig({})).toMatchObject({ provider: "gemini", fallbacks: ["edge"] });
    // An explicit choice still wins.
    expect(resolveTtsConfig({ elevenLabsKeys: KEYS, ttsProvider: "edge" }).provider).toBe("edge");
  });

  it("several keys make the ElevenLabs voice a rotating one; one key keeps the plain voice", () => {
    const rotating = buildTtsProvider({ elevenLabsKeys: KEYS, ttsFallbackProvider: "none" });
    expect(rotating).toBeInstanceOf(KeyRotatingTtsProvider);
    expect(rotating!.id).toBe("elevenlabs");
    expect(rotating!.getDefaultVoice()).toBe("elevenlabs:21m00Tcm4TlvDq8ikWAM");
    expect(buildTtsProvider({ elevenLabsKeys: [KEYS[0]!], ttsFallbackProvider: "none" })).toBeInstanceOf(ElevenLabsTtsProvider);
    // The list and the single-key variable together, each key once.
    expect(buildTtsProvider({ elevenLabsKeys: [KEYS[0]!], elevenLabsApiKey: KEYS[0], ttsFallbackProvider: "none" })).toBeInstanceOf(ElevenLabsTtsProvider);
  });

  it("the default chain with several ElevenLabs keys still ends in Edge's keyless voice", () => {
    const chain = buildTtsProvider({ elevenLabsKeys: KEYS });
    expect(chain).toBeInstanceOf(FallbackTtsProvider);
    expect(chain!.id).toBe("elevenlabs");
  });
});
