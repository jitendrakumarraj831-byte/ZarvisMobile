import { afterEach, describe, expect, it, vi } from "vitest";
import { EdgeTtsProvider, type EdgeTtsProviderOptions } from "../../src/tts/edgeTtsProvider.js";
import { TtsProviderError, isAbortError, type TtsOptions } from "../../src/tts/provider.js";
import { logger } from "../../src/security/redact.js";
import { DEFAULT_ENGLISH_VOICE, DEFAULT_HINDI_VOICE, type VoiceSettings } from "../../src/tts/voices.js";
import { FIXTURE_FRAMES, FakeEdgeTransport, SAMPLES_PER_FRAME, TONE_SAMPLES, edgeLikeMp3, parseWav, pieces, toneMp3, toneOf, wrongRateMp3, type TransportStep } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

const voices: VoiceSettings = { hindi: DEFAULT_HINDI_VOICE, english: DEFAULT_ENGLISH_VOICE, hinglish: DEFAULT_HINDI_VOICE };
const speaks = (hz: 220 | 440 | 880, delayMs?: number): TransportStep => ({ audio: pieces(toneMp3(hz), 600), delayMs });
/** `alpha` is spoken as a 220 Hz tone, `beta` as 440, anything else as 880: the audio says which text it came from. */
const byMarker = (ssml: string): TransportStep => (ssml.includes("alpha") ? speaks(220) : ssml.includes("beta") ? speaks(440) : speaks(880));

function provider(transport: FakeEdgeTransport, extra: Partial<EdgeTtsProviderOptions> = {}): EdgeTtsProvider {
  return new EdgeTtsProvider({ voices, transport, retryDelayMs: 1, ...extra });
}

async function collect(iterable: AsyncIterable<Buffer>): Promise<Buffer> {
  const out: Buffer[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return Buffer.concat(out);
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a failure");
}

const ssmlText = (ssml: string): string => /<prosody[^>]*>([\s\S]*)<\/prosody>/.exec(ssml)![1]!;
const voiceIn = (ssml: string): string => /<voice name='([^']+)'/.exec(ssml)![1]!;
const langIn = (ssml: string): string => /xml:lang='([^']+)'/.exec(ssml)![1]!;
const unavailable = (retryable = true) => new TtsProviderError("down", "UNAVAILABLE", retryable);

describe("which voice speaks", () => {
  it("speaks Hindi with the Hindi voice", async () => {
    const transport = new FakeEdgeTransport([speaks(220)]);
    await collect(provider(transport).synthesizeStream("आप कैसे हैं?"));
    expect(voiceIn(transport.calls[0]!.ssml)).toBe("hi-IN-SwaraNeural");
    expect(langIn(transport.calls[0]!.ssml)).toBe("hi-IN");
  });

  it("speaks English with the English voice", async () => {
    const transport = new FakeEdgeTransport([speaks(220)]);
    await collect(provider(transport).synthesizeStream("How are you?"));
    expect(voiceIn(transport.calls[0]!.ssml)).toBe("en-US-JennyNeural");
    expect(langIn(transport.calls[0]!.ssml)).toBe("en-US");
  });

  it("speaks Hinglish with the configured Hinglish voice", async () => {
    const transport = new FakeEdgeTransport([speaks(220)]);
    await collect(provider(transport, { voices: { ...voices, hinglish: "en-IN-NeerjaNeural" } }).synthesizeStream("Hello sir, aaj kya karna hai?"));
    expect(voiceIn(transport.calls[0]!.ssml)).toBe("en-IN-NeerjaNeural");
    expect(langIn(transport.calls[0]!.ssml)).toBe("en-IN");
  });

  it("lets a caller choose an allowed voice, and ignores one that is not allowed", async () => {
    const transport = new FakeEdgeTransport([speaks(220)]);
    const tts = provider(transport);
    await collect(tts.synthesizeStream("How are you?", { voice: "hi-IN-MadhurNeural" }));
    await collect(tts.synthesizeStream("How are you?", { voice: "en-US-NotAllowedNeural" }));
    await collect(tts.synthesizeStream("How are you?", { voice: "Puck" })); // an old client's voice name: a male style
    expect(transport.calls.map((call) => voiceIn(call.ssml))).toEqual(["hi-IN-MadhurNeural", "en-US-JennyNeural", "en-US-GuyNeural"]);
  });

  it("reports the default voice for a text, English when there is none", () => {
    const tts = provider(new FakeEdgeTransport([speaks(220)]));
    expect(tts.getDefaultVoice()).toBe("en-US-JennyNeural");
    expect(tts.getDefaultVoice("")).toBe("en-US-JennyNeural");
    expect(tts.getDefaultVoice("आप कैसे हैं?")).toBe("hi-IN-SwaraNeural");
    expect(tts.getDefaultVoice("How are you?")).toBe("en-US-JennyNeural");
  });

  it("names itself, for logs and the X-Zarvis-TTS header", () => {
    expect(provider(new FakeEdgeTransport([speaks(220)])).id).toBe("edge");
  });
});

describe("what is sent to the service", () => {
  it("sends Hindi text as Hindi text", async () => {
    const transport = new FakeEdgeTransport([speaks(220)]);
    await collect(provider(transport).synthesizeStream("नमस्ते, मैं ज़ार्विस हूँ। आज मौसम अच्छा है।"));
    expect(ssmlText(transport.calls[0]!.ssml)).toBe("नमस्ते, मैं ज़ार्विस हूँ। आज मौसम अच्छा है।");
  });

  it("escapes special characters, so a reply can never change the markup", async () => {
    const transport = new FakeEdgeTransport([speaks(220)]);
    const hostile = `Tom & Jerry said "hi" </prosody></voice><voice name='hi-IN-MadhurNeural'><prosody rate='+400%'>shout</prosody></voice> <speak>`;
    await collect(provider(transport).synthesizeStream(hostile));
    const ssml = transport.calls[0]!.ssml;
    expect(ssml.match(/<voice /g)).toHaveLength(1);
    expect(ssml.match(/<prosody /g)).toHaveLength(1);
    expect(voiceIn(ssml)).toBe("en-US-JennyNeural");
    expect(ssmlText(ssml)).toContain("Tom &amp; Jerry said &quot;hi&quot; &lt;/prosody&gt;&lt;/voice&gt;");
  });

  it("replaces control characters the service refuses, keeping the words around them", async () => {
    const transport = new FakeEdgeTransport([speaks(220)]);
    await collect(provider(transport).synthesizeStream("page one\u000bpage two\u0000end"));
    expect(ssmlText(transport.calls[0]!.ssml)).toBe("page one page two end");
  });

  it("does not ask the voice to read Markdown, links or emoji", async () => {
    const transport = new FakeEdgeTransport([speaks(220)]);
    await collect(provider(transport).synthesizeStream("**Done!** See [the docs](https://example.com) 🎉 for `details`."));
    expect(ssmlText(transport.calls[0]!.ssml)).toBe("Done! See the docs for details.");
  });

  it("speaks no more than the text limit, however long the text", async () => {
    const transport = new FakeEdgeTransport([speaks(220)]);
    await collect(provider(transport, { maxTextChars: 500 }).synthesizeStream("word ".repeat(5000)));
    const spoken = transport.calls.map((call) => ssmlText(call.ssml)).join(" ");
    expect(spoken.length).toBeLessThanOrEqual(520);
    expect(spoken.length).toBeGreaterThan(300);
  });
});

describe("text that is not speakable", () => {
  it("is refused before any connection is made", async () => {
    const transport = new FakeEdgeTransport([speaks(220)]);
    const tts = provider(transport);
    for (const text of ["", "   ", "\n\t", "...", "!?!", "🎉🎉", "```\ncode only\n```", "https://example.com/only-a-link", "\u0000\u000b"]) {
      const error = await failure(collect(tts.synthesizeStream(text)));
      expect(error, JSON.stringify(text)).toBeInstanceOf(TtsProviderError);
      expect(error).toMatchObject({ kind: "INVALID_REQUEST", retryable: false });
    }
    expect(await failure(collect(tts.synthesizeStream(42 as unknown as string)))).toMatchObject({ kind: "INVALID_REQUEST" });
    expect(await failure(tts.synthesize(""))).toMatchObject({ kind: "INVALID_REQUEST" });
    expect(transport.calls).toHaveLength(0);
  });
});

describe("long text and several parts", () => {
  const sentences = ["alpha alpha alpha alpha alpha alpha alpha alpha.", "beta beta beta beta beta beta beta beta beta.", "gamma gamma gamma gamma gamma gamma gamma."];
  const text = sentences.join(" ");

  it("speaks the parts one after the other, in order, as one continuous stream", async () => {
    const transport = new FakeEdgeTransport(byMarker);
    const pcm = await collect(provider(transport, { maxPartBytes: 60 }).synthesizeStream(text));
    expect(transport.calls.map((call) => ssmlText(call.ssml))).toEqual(sentences);
    expect(pcm.length / 2).toBe(3 * TONE_SAMPLES);
    const tones = [0, 1, 2].map((i) => toneOf(pcm.subarray(i * TONE_SAMPLES * 2, (i + 1) * TONE_SAMPLES * 2)));
    expect(tones).toEqual([220, 440, 880]);
  });

  it("never has two parts of one reply in flight at once", async () => {
    const transport = new FakeEdgeTransport((ssml) => ({ ...byMarker(ssml), delayMs: 5 } as TransportStep));
    await collect(provider(transport, { maxPartBytes: 60 }).synthesizeStream(text));
    expect(transport.peakActive).toBe(1);
  });

  it("keeps every part within the size the service accepts, for Hindi too", async () => {
    const transport = new FakeEdgeTransport([speaks(220)]);
    await collect(provider(transport).synthesizeStream("यह एक लंबा वाक्य है जो बार बार दोहराया जाता है। ".repeat(70)));
    expect(transport.calls.length).toBeGreaterThan(1);
    for (const call of transport.calls) expect(Buffer.byteLength(ssmlText(call.ssml), "utf8")).toBeLessThanOrEqual(3000);
  });

  it("starts the next part with a clean decoder: nothing of the last part leaks into it", async () => {
    const transport = new FakeEdgeTransport([speaks(440)]);
    const pcm = await collect(provider(transport, { maxPartBytes: 60 }).synthesizeStream(text));
    const first = pcm.subarray(0, TONE_SAMPLES * 2);
    expect(pcm.subarray(TONE_SAMPLES * 2, TONE_SAMPLES * 4).equals(first)).toBe(true);
  });
});

describe("unary WAV", () => {
  it("is the streamed audio with a 24 kHz, 16-bit, mono header", async () => {
    const transport = new FakeEdgeTransport([{ audio: pieces(edgeLikeMp3(), 700) }]);
    const tts = provider(transport);
    const wav = await tts.synthesize("How are you?");
    const parsed = parseWav(wav);
    expect(parsed).toMatchObject({ sampleRate: 24_000, channels: 1, bits: 16 });
    expect(parsed.pcm.length / 2).toBe(FIXTURE_FRAMES * SAMPLES_PER_FRAME);
    const streamed = await collect(tts.synthesizeStream("How are you?"));
    expect(parsed.pcm.equals(streamed)).toBe(true);
  });

  it("is made of every part of a long text, in order", async () => {
    const transport = new FakeEdgeTransport(byMarker);
    const wav = await provider(transport, { maxPartBytes: 60 }).synthesize("alpha alpha alpha alpha alpha alpha alpha alpha. beta beta beta beta beta beta beta beta beta.");
    const { pcm } = parseWav(wav);
    expect(pcm.length / 2).toBe(2 * TONE_SAMPLES);
    expect([toneOf(pcm.subarray(0, TONE_SAMPLES * 2)), toneOf(pcm.subarray(TONE_SAMPLES * 2))]).toEqual([220, 440]);
  });
});

describe("what happens when the service fails", () => {
  it("tries a part once more after a temporary failure, and the listener hears one clean copy", async () => {
    const transport = new FakeEdgeTransport([{ fail: unavailable() }, speaks(440)]);
    const pcm = await collect(provider(transport).synthesizeStream("How are you?"));
    expect(transport.calls).toHaveLength(2);
    expect(toneOf(pcm)).toBe(440);
    expect(pcm.length / 2).toBe(TONE_SAMPLES);
  });

  it("gives up after the second failure, with the error as it was: bounded, never forever", async () => {
    const transport = new FakeEdgeTransport([{ fail: unavailable() }]);
    const error = await failure(collect(provider(transport).synthesizeStream("How are you?")));
    expect(error).toBeInstanceOf(TtsProviderError);
    expect(error).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    expect(transport.calls).toHaveLength(2);
  });

  it("does not retry a failure that cannot be temporary", async () => {
    for (const kind of ["REJECTED", "NO_AUDIO", "BAD_AUDIO"] as const) {
      const transport = new FakeEdgeTransport([{ fail: new TtsProviderError("no", kind, false) }]);
      const error = await failure(collect(provider(transport).synthesizeStream("How are you?")));
      expect(error, kind).toMatchObject({ kind });
      expect(transport.calls, kind).toHaveLength(1);
    }
  });

  it("retries a timeout once, then reports it as a timeout", async () => {
    const transport = new FakeEdgeTransport([{ fail: new TtsProviderError("slow", "TIMEOUT", true) }]);
    const error = await failure(collect(provider(transport).synthesizeStream("How are you?")));
    expect(error).toMatchObject({ kind: "TIMEOUT" });
    expect(transport.calls).toHaveLength(2);
  });

  it("never repeats audio that has already been heard: a failure after sound began surfaces, with no retry", async () => {
    const mp3 = edgeLikeMp3();
    const transport = new FakeEdgeTransport([{ fail: unavailable(), afterChunks: pieces(mp3.subarray(0, 3000), 500) }, speaks(440)]);
    const heard: Buffer[] = [];
    let error: unknown;
    try {
      for await (const chunk of provider(transport).synthesizeStream("How are you?")) heard.push(chunk);
    } catch (caught) {
      error = caught;
    }
    expect(heard.length).toBeGreaterThan(0);
    expect(error).toMatchObject({ kind: "UNAVAILABLE" });
    expect(transport.calls).toHaveLength(1);
  });

  it("retries only the part that failed, and the parts before it are not spoken again", async () => {
    let betaAttempts = 0;
    const transport = new FakeEdgeTransport((ssml) => {
      if (ssml.includes("beta") && betaAttempts++ === 0) return { fail: unavailable() };
      return byMarker(ssml);
    });
    const pcm = await collect(provider(transport, { maxPartBytes: 60 }).synthesizeStream("alpha alpha alpha alpha alpha alpha alpha alpha. beta beta beta beta beta beta beta beta beta. gamma gamma gamma gamma gamma gamma gamma."));
    expect(transport.calls.map((call) => ssmlText(call.ssml).split(" ")[0])).toEqual(["alpha", "beta", "beta", "gamma"]);
    expect([0, 1, 2].map((i) => toneOf(pcm.subarray(i * TONE_SAMPLES * 2, (i + 1) * TONE_SAMPLES * 2)))).toEqual([220, 440, 880]);
  });

  it("reports an unexpected exception as an unavailable voice, once, without retrying a bug", async () => {
    const transport = new FakeEdgeTransport([{ fail: new TypeError("a bug") }]);
    const error = await failure(collect(provider(transport).synthesizeStream("How are you?")));
    expect(error).toBeInstanceOf(TtsProviderError);
    expect(error).toMatchObject({ kind: "UNAVAILABLE", retryable: false });
    expect((error as TtsProviderError).cause).toBeInstanceOf(TypeError);
    expect(transport.calls).toHaveLength(1);
  });

  it("refuses audio that is malformed, and audio at the wrong sample rate, without retrying", async () => {
    const garbage = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 37 + 11) % 251));
    for (const [label, audio] of [["garbage", pieces(garbage, 500)], ["a web page", [Buffer.from("<html>blocked</html>")]], ["48 kHz audio", [wrongRateMp3()]]] as const) {
      const transport = new FakeEdgeTransport([{ audio: [...audio] }]);
      const error = await failure(collect(provider(transport).synthesizeStream("How are you?")));
      expect(error, label).toMatchObject({ kind: "BAD_AUDIO", retryable: false });
      expect(transport.calls, label).toHaveLength(1);
    }
  });

  it("calls a service that ends the turn with no audio at all an error, not silence", async () => {
    const transport = new FakeEdgeTransport([{ audio: [] }]);
    const error = await failure(collect(provider(transport).synthesizeStream("How are you?")));
    expect(error).toMatchObject({ kind: "BAD_AUDIO" });
    expect(await failure(provider(transport).synthesize("How are you?"))).toMatchObject({ kind: "BAD_AUDIO" });
  });
});

describe("cancelling", () => {
  it("stops the upstream connection and reports an abort, not a failure, when the signal fires mid-stream", async () => {
    const transport = new FakeEdgeTransport([speaks(220, 20)]);
    const controller = new AbortController();
    const received: Buffer[] = [];
    let error: unknown;
    try {
      for await (const chunk of provider(transport).synthesizeStream("How are you?", { signal: controller.signal })) {
        received.push(chunk);
        controller.abort();
      }
    } catch (caught) {
      error = caught;
    }
    expect(isAbortError(error)).toBe(true);
    expect(error).not.toBeInstanceOf(TtsProviderError);
    expect(transport.finalized).toBe(1);
    expect(received.length).toBeGreaterThan(0);
  });

  it("does nothing at all for a signal that is already aborted", async () => {
    const transport = new FakeEdgeTransport([speaks(220)]);
    const controller = new AbortController();
    controller.abort();
    expect(isAbortError(await failure(collect(provider(transport).synthesizeStream("How are you?", { signal: controller.signal }))))).toBe(true);
    expect(isAbortError(await failure(provider(transport).synthesize("How are you?", { signal: controller.signal })))).toBe(true);
    expect(transport.calls).toHaveLength(0);
  });

  it("cancels a request that is waiting on the service, and a unary one too", async () => {
    const transport = new FakeEdgeTransport([{ hang: true }]);
    const controller = new AbortController();
    const pending = failure(provider(transport).synthesize("How are you?", { signal: controller.signal }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    expect(isAbortError(await pending)).toBe(true);
    expect(transport.finalized).toBe(1);
  });

  it("cancels the pause before a retry instead of waiting it out", async () => {
    const transport = new FakeEdgeTransport([{ fail: unavailable() }, speaks(220)]);
    const controller = new AbortController();
    const started = Date.now();
    const pending = failure(collect(provider(transport, { retryDelayMs: 10_000 }).synthesizeStream("How are you?", { signal: controller.signal })));
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();
    expect(isAbortError(await pending)).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(transport.calls).toHaveLength(1);
  });

  it("releases the upstream connection when the consumer stops reading", async () => {
    const transport = new FakeEdgeTransport([speaks(220, 10)]);
    const iterator = provider(transport).synthesizeStream("How are you?")[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    await iterator.return?.(undefined);
    expect(transport.finalized).toBe(1);
  });

  it("does not count cancellations against the service: the circuit stays closed", async () => {
    const transport = new FakeEdgeTransport([speaks(220, 10)]);
    const tts = provider(transport, { breakerThreshold: 2 });
    for (let i = 0; i < 6; i += 1) {
      const controller = new AbortController();
      const iterator = tts.synthesizeStream("How are you?", { signal: controller.signal })[Symbol.asyncIterator]();
      await iterator.next();
      controller.abort();
      await iterator.next().catch(() => undefined);
      await iterator.return?.(undefined);
    }
    expect((await collect(tts.synthesizeStream("How are you?"))).length).toBeGreaterThan(0);
  });
});

describe("protecting the service", () => {
  it("never runs more syntheses than allowed, makes a few wait, and says busy to the rest", async () => {
    const transport = new FakeEdgeTransport([speaks(220, 30)]);
    const tts = provider(transport, { maxConcurrent: 2, maxQueued: 1 });
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => collect(tts.synthesizeStream("How are you?"))));
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ kind: "UNAVAILABLE", retryable: true, retryAfterMs: 1000 });
    expect(transport.peakActive).toBe(2);
    expect(transport.calls).toHaveLength(3);
  });

  it("lets a waiting request leave without taking a slot", async () => {
    const transport = new FakeEdgeTransport([speaks(220, 30)]);
    const tts = provider(transport, { maxConcurrent: 1, maxQueued: 2 });
    const first = collect(tts.synthesizeStream("How are you?"));
    const controller = new AbortController();
    const second = failure(collect(tts.synthesizeStream("How are you?", { signal: controller.signal })));
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    expect(isAbortError(await second)).toBe(true);
    await first;
    expect((await collect(tts.synthesizeStream("How are you?"))).length).toBeGreaterThan(0); // the slot was not lost
    expect(transport.calls).toHaveLength(2);
  });

  it("gives its slot back when a synthesis fails", async () => {
    const transport = new FakeEdgeTransport((_ssml, call) => (call < 2 ? { fail: new TtsProviderError("no", "REJECTED", false) } : speaks(220)));
    const tts = provider(transport, { maxConcurrent: 1, maxQueued: 0, breakerThreshold: 10 });
    await failure(collect(tts.synthesizeStream("How are you?")));
    await failure(collect(tts.synthesizeStream("How are you?")));
    expect((await collect(tts.synthesizeStream("How are you?"))).length).toBeGreaterThan(0);
  });

  describe("the circuit breaker", () => {
    function failing(clock: { t: number }) {
      const transport = new FakeEdgeTransport((_ssml, call) => (clock.t < 100_000 ? { fail: unavailable() } : speaks(220)));
      const tts = provider(transport, { breakerThreshold: 3, breakerOpenMs: 30_000, now: () => clock.t });
      return { transport, tts };
    }

    it("opens after repeated failures and then fails at once, without asking the service", async () => {
      const clock = { t: 0 };
      const { transport, tts } = failing(clock);
      for (let i = 0; i < 3; i += 1) expect(await failure(collect(tts.synthesizeStream("How are you?")))).toMatchObject({ kind: "UNAVAILABLE" });
      const callsBefore = transport.calls.length;
      const error = await failure(collect(tts.synthesizeStream("How are you?")));
      expect(error).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
      expect((error as TtsProviderError).retryAfterMs).toBeGreaterThan(0);
      expect(transport.calls).toHaveLength(callsBefore);
    });

    it("lets one request through after the pause, closes when it works, and reopens when it does not", async () => {
      const clock = { t: 0 };
      const { transport, tts } = failing(clock);
      for (let i = 0; i < 3; i += 1) await failure(collect(tts.synthesizeStream("How are you?")));

      clock.t = 31_000; // pause over, but the service is still down: the probe fails and the circuit reopens
      const calls = transport.calls.length;
      await failure(collect(tts.synthesizeStream("How are you?")));
      expect(transport.calls.length).toBeGreaterThan(calls);
      const afterProbe = transport.calls.length;
      await failure(collect(tts.synthesizeStream("How are you?")));
      expect(transport.calls).toHaveLength(afterProbe); // open again

      clock.t = 200_000; // the service is back: the probe succeeds and everything flows again
      expect((await collect(tts.synthesizeStream("How are you?"))).length).toBeGreaterThan(0);
      expect((await collect(tts.synthesizeStream("How are you?"))).length).toBeGreaterThan(0);
    });

    it("lets only one probe through at a time", async () => {
      const clock = { t: 0 };
      const transport = new FakeEdgeTransport((_ssml, call) => (call < 6 ? { fail: unavailable() } : speaks(220, 40)));
      const tts = provider(transport, { breakerThreshold: 3, breakerOpenMs: 30_000, now: () => clock.t });
      for (let i = 0; i < 3; i += 1) await failure(collect(tts.synthesizeStream("How are you?")));
      clock.t = 31_000;
      const results = await Promise.allSettled([1, 2, 3].map(() => collect(tts.synthesizeStream("How are you?"))));
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(transport.calls).toHaveLength(7);
    });

    it("is not opened by requests that were wrong rather than the service being down", async () => {
      const transport = new FakeEdgeTransport([{ fail: new TtsProviderError("no sound", "NO_AUDIO", false) }]);
      const tts = provider(transport, { breakerThreshold: 2 });
      for (let i = 0; i < 5; i += 1) expect(await failure(collect(tts.synthesizeStream("How are you?")))).toMatchObject({ kind: "NO_AUDIO" });
      expect(transport.calls).toHaveLength(5);
    });
  });
});

describe("several requests at once", () => {
  it("keeps each one's audio its own: nothing is mixed between replies", async () => {
    const transport = new FakeEdgeTransport((ssml) => ({ ...byMarker(ssml), delayMs: 3 }) as TransportStep);
    const tts = provider(transport);
    const texts = ["alpha alpha alpha", "beta beta beta", "gamma gamma gamma", "alpha alpha again", "beta beta again", "gamma gamma again"];
    const results = await Promise.all(texts.map((text) => collect(tts.synthesizeStream(text))));
    expect(results.map((pcm) => toneOf(pcm))).toEqual([220, 440, 880, 220, 440, 880]);
    for (const pcm of results) expect(pcm.length / 2).toBe(TONE_SAMPLES);
  });

  it("keeps long replies apart too, part by part", async () => {
    const transport = new FakeEdgeTransport((ssml) => ({ ...byMarker(ssml), delayMs: 2 }) as TransportStep);
    const tts = provider(transport, { maxPartBytes: 60 });
    const first = "alpha alpha alpha alpha alpha alpha alpha alpha. beta beta beta beta beta beta beta beta beta.";
    const second = "gamma gamma gamma gamma gamma gamma gamma. alpha alpha alpha alpha alpha alpha alpha alpha.";
    const [a, b] = await Promise.all([collect(tts.synthesizeStream(first)), collect(tts.synthesizeStream(second))]);
    const tones = (pcm: Buffer) => [0, 1].map((i) => toneOf(pcm.subarray(i * TONE_SAMPLES * 2, (i + 1) * TONE_SAMPLES * 2)));
    expect(tones(a)).toEqual([220, 440]);
    expect(tones(b)).toEqual([880, 220]);
  });
});

describe("logging", () => {
  it("records the engine, voice and sizes of a call, and never the text", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const secret = "my password is swordfish and my phone number is 5551234";
    await collect(provider(new FakeEdgeTransport([speaks(220)])).synthesizeStream(secret));
    const call = info.mock.calls.find(([message]) => message === "TTS call");
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ engine: "edge", voice: "en-US-JennyNeural", language: "en", parts: 1, pcmBytes: TONE_SAMPLES * 2 });
    expect(JSON.stringify(info.mock.calls)).not.toContain("swordfish");
  });

  it("does not log the text of a failed call either", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    await failure(collect(provider(new FakeEdgeTransport([{ fail: unavailable() }])).synthesizeStream("my password is swordfish")));
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("swordfish");
  });
});

describe("the options it was given", () => {
  it("uses the real wire by default (nothing is contacted until a voice is asked for)", () => {
    expect(() => new EdgeTtsProvider({ voices })).not.toThrow();
  });

  it("passes the caller's signal to the transport, so cancelling reaches the connection", async () => {
    const transport = new FakeEdgeTransport([speaks(220)]);
    const controller = new AbortController();
    const options: TtsOptions = { signal: controller.signal };
    await collect(provider(transport).synthesizeStream("How are you?", options));
    expect(transport.calls[0]!.signal).toBe(controller.signal);
  });
});
