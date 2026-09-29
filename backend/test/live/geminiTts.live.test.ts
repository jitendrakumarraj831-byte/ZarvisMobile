import { describe, expect, it } from "vitest";
import { GeminiTtsProvider } from "../../src/ai/geminiTts.js";
import { env } from "../../src/config/env.js";

/**
 * Live check of Gemini native-audio TTS against Google's real API (not a stub).
 * Opt-in only, because it spends real quota:
 *
 *   ZARVIS_LIVE_TESTS=1 GEMINI_API_KEY=<test key> npx vitest run test/live/geminiTts.live.test.ts
 *
 * Skipped (never passed) without both variables.
 */
const enabled = process.env.ZARVIS_LIVE_TESTS === "1" && !!process.env.GEMINI_API_KEY;

describe.skipIf(!enabled)("LIVE Gemini TTS", () => {
  it("returns real speech audio for a short sentence", async () => {
    const provider = new GeminiTtsProvider(process.env.GEMINI_API_KEY!, env.geminiTtsModel, env.geminiTtsVoice);
    const wav = await provider.synthesize("This is a ZARVIS live text to speech check.");
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    const sampleRate = wav.readUInt32LE(24);
    const dataBytes = wav.length - 44;
    const seconds = dataBytes / (sampleRate * 2);
    // A real sentence is roughly 1.5–6 s of 16-bit mono audio.
    expect(seconds).toBeGreaterThan(1);
    expect(seconds).toBeLessThan(15);
    console.log(`ZARVIS_LIVE gemini_tts model=${env.geminiTtsModel} voice=${env.geminiTtsVoice} sampleRate=${sampleRate} seconds=${seconds.toFixed(2)} bytes=${wav.length}`);
  }, 60_000);
});
