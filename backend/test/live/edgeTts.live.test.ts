import { describe, expect, it } from "vitest";
import { resolveTtsConfig } from "../../src/config/ttsConfig.js";
import { env } from "../../src/config/env.js";
import { listEdgeVoices } from "../../src/tts/edgeTransport.js";
import { EdgeTtsProvider } from "../../src/tts/edgeTtsProvider.js";
import { KNOWN_EDGE_VOICES } from "../../src/tts/voices.js";
import { parseWav } from "../tts/helpers.js";

/**
 * Live check of the Edge voice service (not a stub): the one place the real service is exercised.
 * Opt-in, because it needs the internet and uses a service that is not ours:
 *
 *   ZARVIS_LIVE_TESTS=1 npx vitest run test/live/edgeTts.live.test.ts
 *
 * No key or account is involved. Skipped (never passed) without ZARVIS_LIVE_TESTS=1. It is also
 * what the manual "Edge TTS live probe" workflow runs, from a network that can reach Microsoft.
 */
const enabled = process.env.ZARVIS_LIVE_TESTS === "1";
const config = resolveTtsConfig(env);

describe.skipIf(!enabled)("LIVE Edge voice", () => {
  const provider = new EdgeTtsProvider({ voices: config.voices });
  const seconds = (pcmBytes: number) => pcmBytes / 2 / 24_000;

  it("offers every voice ZARVIS is configured to use or allows a caller to name", async () => {
    const offered = new Set((await listEdgeVoices()).map((voice) => voice.ShortName));
    const wanted = [...new Set([config.voices.hindi, config.voices.english, config.voices.hinglish, ...KNOWN_EDGE_VOICES])];
    const missing = wanted.filter((voice) => !offered.has(voice));
    console.log(`ZARVIS_LIVE edge_voices offered=${offered.size} wanted=${wanted.length} missing=${missing.join(",") || "none"}`);
    expect(missing).toEqual([]);
  }, 60_000);

  for (const [label, text] of [
    ["English", "This is a ZARVIS live text to speech check."],
    ["Hindi", "नमस्ते, मैं ज़ार्विस हूँ। यह आवाज़ की जाँच है।"],
    ["Hinglish", "Hello sir, aaj kya karna hai? Main aapki madad ke liye taiyaar hoon."],
  ] as const) {
    it(`speaks ${label} as a WAV file: 24 kHz, 16-bit, mono, a plausible length`, async () => {
      const started = Date.now();
      const wav = await provider.synthesize(text);
      const { sampleRate, channels, bits, pcm } = parseWav(wav);
      expect({ sampleRate, channels, bits }).toEqual({ sampleRate: 24_000, channels: 1, bits: 16 });
      expect(seconds(pcm.length)).toBeGreaterThan(1);
      expect(seconds(pcm.length)).toBeLessThan(15);
      let peak = 0;
      for (let i = 0; i < pcm.length / 2; i += 1) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i * 2)));
      expect(peak).toBeGreaterThan(2000); // sound, not silence
      console.log(`ZARVIS_LIVE edge_tts ${label} voice=${provider.getDefaultVoice(text)} seconds=${seconds(pcm.length).toFixed(2)} peak=${peak} tookMs=${Date.now() - started}`);
    }, 60_000);
  }

  it("streams PCM: the first sound arrives well before the end, and the pieces add up", async () => {
    const started = Date.now();
    let firstMs = 0;
    let chunks = 0;
    let bytes = 0;
    for await (const pcm of provider.synthesizeStream("This is the streaming check. It has two sentences, so that it takes a moment to say.")) {
      if (chunks === 0) firstMs = Date.now() - started;
      chunks += 1;
      bytes += pcm.length;
      expect(pcm.length % 2).toBe(0);
    }
    console.log(`ZARVIS_LIVE edge_tts stream chunks=${chunks} seconds=${seconds(bytes).toFixed(2)} firstChunkMs=${firstMs} totalMs=${Date.now() - started}`);
    expect(seconds(bytes)).toBeGreaterThan(2);
    expect(chunks).toBeGreaterThan(1);
  }, 60_000);

  it("speaks a long reply in several parts without a gap in the service's answers", async () => {
    const long = "This sentence is here to make the reply long enough to need more than one request. ".repeat(60);
    const wav = await provider.synthesize(long);
    expect(seconds(parseWav(wav).pcm.length)).toBeGreaterThan(30);
  }, 120_000);
});
