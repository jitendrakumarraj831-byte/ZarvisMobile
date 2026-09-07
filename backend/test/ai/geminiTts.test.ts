import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiTtsProvider } from "../../src/ai/geminiTts.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GeminiTtsProvider.synthesize", () => {
  it("sends the expected request and wraps the returned PCM in a valid WAV header", async () => {
    const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain("models/gemini-2.5-flash-preview-tts:generateContent");
      expect(url).toContain("key=test-key");
      const body = JSON.parse(init.body as string);
      expect(body.contents).toEqual([{ role: "user", parts: [{ text: "hello" }] }]);
      expect(body.generationConfig).toEqual({
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      });
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString("base64"), mimeType: "audio/L16;rate=24000" } }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiTtsProvider("test-key", "gemini-2.5-flash-preview-tts", "Kore");
    const wav = await provider.synthesize("hello");

    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(24000); // sample rate field
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.subarray(44)).toEqual(pcm); // PCM payload follows the 44-byte header untouched
  });

  it("falls back to 24kHz when the response omits a sample rate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from([9, 9]).toString("base64") } }] } }] }),
          { status: 200 },
        ),
      ),
    );
    const provider = new GeminiTtsProvider("test-key", "gemini-2.5-flash-preview-tts", "Kore");
    const wav = await provider.synthesize("hi");
    expect(wav.readUInt32LE(24)).toBe(24000);
  });

  it("throws honestly on a non-2xx response — never fakes success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad request", { status: 400, statusText: "Bad Request" })));
    const provider = new GeminiTtsProvider("test-key", "gemini-2.5-flash-preview-tts", "Kore");
    await expect(provider.synthesize("hi")).rejects.toThrow(/Gemini TTS failed: 400/);
  });

  it("throws when the response has no audio data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 })));
    const provider = new GeminiTtsProvider("test-key", "gemini-2.5-flash-preview-tts", "Kore");
    await expect(provider.synthesize("hi")).rejects.toThrow(/no audio data/);
  });
});
