import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/security/redact.js";
import { FallbackTtsProvider } from "../../src/tts/fallbackTtsProvider.js";
import { TtsProviderError, type TtsErrorKind, type TtsOptions } from "../../src/tts/provider.js";
import { FakeTtsProvider, parseWav, pcmTone } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

const edgeTone = pcmTone(0.2, 440);
const geminiTone = pcmTone(0.2, 880);

function pair(primary: ConstructorParameters<typeof FakeTtsProvider>[0], secondary: ConstructorParameters<typeof FakeTtsProvider>[0] = { pcm: [geminiTone] }) {
  const first = new FakeTtsProvider({ pcm: [edgeTone], ...primary });
  first.id = "edge";
  const second = new FakeTtsProvider(secondary);
  second.id = "gemini";
  return { first, second, voice: new FallbackTtsProvider(first, second) };
}

async function collect(stream: AsyncIterable<Buffer>): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

const fail = (kind: TtsErrorKind) => new TtsProviderError(`edge ${kind}`, kind, kind !== "REJECTED");

describe("FallbackTtsProvider", () => {
  it("lets the primary speak, never asks the secondary, and takes the primary's id and default voice", async () => {
    const { first, second, voice } = pair({});
    expect(voice.id).toBe("edge");
    expect(voice.getDefaultVoice("Hello")).toBe("fake-voice");
    expect(Buffer.concat(await collect(voice.synthesizeStream("Hello"))).equals(edgeTone)).toBe(true);
    expect(parseWav(await voice.synthesize("Hello")).pcm.equals(edgeTone)).toBe(true);
    expect(first.calls).toHaveLength(2);
    expect(second.calls).toHaveLength(0);
  });

  it.each(["UNAVAILABLE", "TIMEOUT", "REJECTED", "NO_AUDIO", "BAD_AUDIO"] as const)("speaks with the secondary when the primary fails with %s before any sound", async (kind) => {
    const { second, voice } = pair({ error: fail(kind) });
    expect(Buffer.concat(await collect(voice.synthesizeStream("Hello"))).equals(geminiTone)).toBe(true);
    expect(parseWav(await voice.synthesize("Hello")).pcm.equals(geminiTone)).toBe(true);
    expect(second.calls.map((call) => call.kind)).toEqual(["stream", "unary"]);
  });

  it("also covers a primary that breaks in a way it does not name (a plain Error)", async () => {
    const { voice } = pair({ error: new Error("socket exploded") });
    expect(Buffer.concat(await collect(voice.synthesizeStream("Hello"))).equals(geminiTone)).toBe(true);
  });

  it("does not ask the secondary when there is nothing to say: it would say the same", async () => {
    const { second, voice } = pair({ error: fail("INVALID_REQUEST") });
    await expect(collect(voice.synthesizeStream("🙂"))).rejects.toMatchObject({ kind: "INVALID_REQUEST" });
    await expect(voice.synthesize("🙂")).rejects.toMatchObject({ kind: "INVALID_REQUEST" });
    expect(second.calls).toHaveLength(0);
  });

  it("does not treat a cancelled request as a failure: the secondary is not started", async () => {
    const controller = new AbortController();
    const { second, voice } = pair({ hang: true });
    const pending = collect(voice.synthesizeStream("Hello", { signal: controller.signal }));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(second.calls).toHaveLength(0);

    // Even when the primary reports an ordinary error, a request that was cancelled stays cancelled.
    const stopped = new AbortController();
    stopped.abort();
    const again = pair({ error: fail("UNAVAILABLE") });
    await expect(collect(again.voice.synthesizeStream("Hello", { signal: stopped.signal }))).rejects.toThrow();
    expect(again.second.calls).toHaveLength(0);
  });

  it("never mixes two voices in one reply: a failure after the first sound surfaces, and the secondary is not asked", async () => {
    const { second, voice } = pair({ pcm: [edgeTone, edgeTone, edgeTone], error: fail("UNAVAILABLE"), errorAfter: 1 });
    const received: Buffer[] = [];
    await expect(
      (async () => {
        for await (const chunk of voice.synthesizeStream("A long reply")) received.push(chunk);
      })(),
    ).rejects.toMatchObject({ kind: "UNAVAILABLE" });
    expect(received).toHaveLength(1); // what was already spoken stays; nothing is repeated
    expect(received[0]!.equals(edgeTone)).toBe(true);
    expect(second.calls).toHaveLength(0);
  });

  it("makes one hop and no more: when the secondary fails too, its error is the answer", async () => {
    const { first, second, voice } = pair({ error: fail("UNAVAILABLE") }, { error: new TtsProviderError("gemini quota", "UNAVAILABLE", false) });
    await expect(collect(voice.synthesizeStream("Hello"))).rejects.toMatchObject({ message: "gemini quota", retryable: false });
    await expect(voice.synthesize("Hello")).rejects.toMatchObject({ message: "gemini quota" });
    expect(first.calls).toHaveLength(2);
    expect(second.calls).toHaveLength(2);
  });

  it("passes the caller's voice and signal to whichever provider speaks", async () => {
    const controller = new AbortController();
    const { first, second, voice } = pair({ error: fail("UNAVAILABLE") });
    await collect(voice.synthesizeStream("Hello", { voice: "hi-IN-MadhurNeural", signal: controller.signal }));
    expect(first.calls[0]).toMatchObject({ voice: "hi-IN-MadhurNeural", signal: controller.signal });
    expect(second.calls[0]).toMatchObject({ voice: "hi-IN-MadhurNeural", signal: controller.signal });
  });

  it("reports the voice that spoke last, so the route can name the engine that really answered", async () => {
    const seen: Array<{ voice: string; engine?: string }> = [];
    const onResolved: TtsOptions["onResolved"] = (info) => seen.push({ voice: info.voice, engine: info.engine });
    const { voice } = pair(
      { error: fail("REJECTED"), resolved: { voice: "en-US-JennyNeural", language: "en" } },
      { pcm: [geminiTone], resolved: { voice: "gemini:Kore", language: "en", engine: "gemini" } },
    );
    await collect(voice.synthesizeStream("Hello", { onResolved }));
    expect(seen).toEqual([{ voice: "en-US-JennyNeural", engine: undefined }, { voice: "gemini:Kore", engine: "gemini" }]);
  });

  it("says that it fell back, and why, but never what was said", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const { voice } = pair({ error: fail("REJECTED") });
    await collect(voice.synthesizeStream("My secret sentence about my bank"));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toEqual({ primary: "edge", fallback: "gemini", kind: "REJECTED" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
  });

  it("keeps using the primary on the next request: one failure is not a switch", async () => {
    let calls = 0;
    const first = new FakeTtsProvider({ pcm: [edgeTone] });
    const flaky = {
      id: "edge",
      getDefaultVoice: () => "v",
      synthesize: first.synthesize.bind(first),
      async *synthesizeStream(text: string, options?: TtsOptions) {
        calls += 1;
        if (calls === 1) throw fail("UNAVAILABLE");
        yield* first.synthesizeStream(text, options);
      },
    };
    const second = new FakeTtsProvider({ pcm: [geminiTone] });
    const voice = new FallbackTtsProvider(flaky, second);
    expect(Buffer.concat(await collect(voice.synthesizeStream("one"))).equals(geminiTone)).toBe(true);
    expect(Buffer.concat(await collect(voice.synthesizeStream("two"))).equals(edgeTone)).toBe(true);
    expect(second.calls).toHaveLength(1);
  });
});
