import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiTtsProvider } from "../../src/ai/geminiTts.js";

afterEach(() => vi.unstubAllGlobals());

describe("GeminiTtsProvider.synthesize", () => {
  it("requests Gemini 3.8 TTS and returns its WAV bytes unchanged", async () => {
    const wav = Buffer.from("RIFF-test-wav", "ascii");
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain("models/gemini-3.8-flash-tts:generateContent");
      expect(init.headers).toMatchObject({ "x-goog-api-key": "test-key" });
      const body = JSON.parse(init.body as string);
      expect(body.contents).toEqual([{ role: "user", parts: [{ text: "hello" }] }]);
      expect(body.generationConfig).toEqual({
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { voice: "Kore" } },
      });
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { data: wav.toString("base64"), mimeType: "audio/wav" } }] } }],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiTtsProvider("test-key", "gemini-3.8-flash-tts", "Kore");
    await expect(provider.synthesize("hello")).resolves.toEqual(wav);
  });

  it("retries transient 503 failures and succeeds", async () => {
    const wav = Buffer.from("RIFF-ok", "ascii");
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      if (calls < 3) return new Response("busy", { status: 503, statusText: "Service Unavailable" });
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { data: wav.toString("base64"), mimeType: "audio/wav" } }] } }],
      }), { status: 200 });
    }));

    const provider = new GeminiTtsProvider("test-key", "gemini-3.8-flash-tts", "Kore");
    await expect(provider.synthesize("hi")).resolves.toEqual(wav);
    expect(calls).toBe(3);
  });

  it("does not retry permanent 400 errors", async () => {
    const fetchMock = vi.fn(async () => new Response("bad request", { status: 400, statusText: "Bad Request" }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GeminiTtsProvider("test-key", "gemini-3.8-flash-tts", "Kore");
    await expect(provider.synthesize("hi")).rejects.toThrow(/Gemini TTS failed: 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when Gemini returns no audio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 })));
    const provider = new GeminiTtsProvider("test-key", "gemini-3.8-flash-tts", "Kore");
    await expect(provider.synthesize("hi")).rejects.toThrow(/no audio data/);
  });
});
