import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiTtsProvider } from "../../src/ai/geminiTts.js";

afterEach(() => vi.unstubAllGlobals());

describe("GeminiTtsProvider.synthesize", () => {
  it("requests Gemini TTS with the documented voice config and passes WAV through unchanged", async () => {
    const wav = Buffer.from("RIFF-test-wav", "ascii");
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain("models/gemini-3.8-flash-tts:generateContent");
      expect(init.headers).toMatchObject({ "x-goog-api-key": "test-key" });
      const body = JSON.parse(init.body as string);
      expect(body.contents).toEqual([{ role: "user", parts: [{ text: "hello" }] }]);
      expect(body.generationConfig).toEqual({
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
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

  it("wraps raw L16 PCM in a valid WAV header", async () => {
    const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString("base64"), mimeType: "audio/L16;codec=pcm;rate=24000" } }] } }],
    }), { status: 200 })));
    const provider = new GeminiTtsProvider("test-key", "gemini-3.8-flash-tts", "Kore");
    const wav = await provider.synthesize("hi");
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.subarray(44)).toEqual(pcm);
  });

  it("moves to the next model on 404 but stops on other permanent errors", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return urls.length === 1
        ? new Response("not found", { status: 404, statusText: "Not Found" })
        : new Response("bad request", { status: 400, statusText: "Bad Request" });
    }));
    const provider = new GeminiTtsProvider("test-key", "custom-tts", "Kore");
    await expect(provider.synthesize("hi")).rejects.toThrow(/400/);
    expect(urls).toHaveLength(2);
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

describe("GeminiTtsProvider quota handling", () => {
  it("moves to the next TTS model when one model's daily quota is exhausted", async () => {
    const wav = Buffer.from("RIFF-ok", "ascii");
    const urls: string[] = [];
    const dailyQuota = JSON.stringify({
      error: { details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }] }] },
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      if (urls.length === 1) return new Response(dailyQuota, { status: 429 });
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { data: wav.toString("base64"), mimeType: "audio/wav" } }] } }],
      }), { status: 200 });
    }));
    const provider = new GeminiTtsProvider("test-key", "gemini-3.8-flash-lite-tts", "Kore");
    await expect(provider.synthesize("hi")).resolves.toEqual(wav);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("gemini-3.8-flash-lite-tts");
    expect(urls[1]).toContain("gemini-3.8-flash-tts");
  });
});
