import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTtsProvider, resolveTtsConfig } from "../../src/config/ttsConfig.js";
import { EdgeTtsProvider } from "../../src/tts/edgeTtsProvider.js";
import { logger } from "../../src/security/redact.js";
import { pcmToWav, TTS_SAMPLE_RATE } from "../../src/tts/wav.js";
import { parseWav, pcmTone } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

describe("resolveTtsConfig", () => {
  it("defaults to Edge, with Swara for Hindi, Jenny for English, and the Hindi voice for Hinglish", () => {
    expect(resolveTtsConfig({})).toEqual({ provider: "edge", voices: { hindi: "hi-IN-SwaraNeural", english: "en-US-JennyNeural", hinglish: "hi-IN-SwaraNeural" } });
  });

  it("reads the configured voices, and the Hinglish voice follows the Hindi one unless it is set", () => {
    expect(resolveTtsConfig({ ttsHindiVoice: "hi-IN-MadhurNeural", ttsEnglishVoice: "en-GB-SoniaNeural" }).voices).toEqual({
      hindi: "hi-IN-MadhurNeural",
      english: "en-GB-SoniaNeural",
      hinglish: "hi-IN-MadhurNeural",
    });
    expect(resolveTtsConfig({ ttsHinglishVoice: "en-IN-NeerjaNeural" }).voices.hinglish).toBe("en-IN-NeerjaNeural");
  });

  it("ignores blank settings (an empty variable in a dashboard is not a choice)", () => {
    expect(resolveTtsConfig({ ttsProvider: "  ", ttsHindiVoice: "", ttsEnglishVoice: "   ", ttsHinglishVoice: "" })).toEqual(resolveTtsConfig({}));
  });

  it("accepts the provider in any case, and `none` switches spoken replies off", () => {
    expect(resolveTtsConfig({ ttsProvider: "EDGE" }).provider).toBe("edge");
    expect(resolveTtsConfig({ ttsProvider: " none " }).provider).toBe("none");
  });

  it("reports a provider it does not know, including the retired `gemini`, and uses Edge instead of stopping the server", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    for (const value of ["gemini", "google_cloud", "azure", "true"]) expect(resolveTtsConfig({ ttsProvider: value }).provider).toBe("edge");
    expect(warn).toHaveBeenCalledTimes(4);
    expect(String(warn.mock.calls[0]![0])).toContain("TTS_PROVIDER");
  });

  it("reports a voice name that is not one and uses the default instead", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const config = resolveTtsConfig({ ttsHindiVoice: "Swara", ttsEnglishVoice: "en-US-Jenny Neural", ttsHinglishVoice: "Kore" });
    expect(config.voices).toEqual({ hindi: "hi-IN-SwaraNeural", english: "en-US-JennyNeural", hinglish: "hi-IN-SwaraNeural" });
    expect(warn.mock.calls.map(([message]) => String(message).split(" ")[0])).toEqual(["TTS_HI_VOICE", "TTS_EN_VOICE", "TTS_HINGLISH_VOICE"]);
  });

  it("never puts what was typed into the log, only the variable that is wrong", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    resolveTtsConfig({ ttsHindiVoice: "oops-typed-value" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("oops-typed-value");
  });
});

describe("buildTtsProvider", () => {
  it("builds the Edge voice by default, and needs no key to do it", () => {
    const provider = buildTtsProvider({});
    expect(provider).toBeInstanceOf(EdgeTtsProvider);
    expect(provider!.id).toBe("edge");
    expect(provider!.getDefaultVoice("How are you?")).toBe("en-US-JennyNeural");
    expect(provider!.getDefaultVoice("आप कैसे हैं?")).toBe("hi-IN-SwaraNeural");
  });

  it("builds it with the configured voices", () => {
    const provider = buildTtsProvider({ ttsHindiVoice: "hi-IN-MadhurNeural", ttsEnglishVoice: "en-US-AriaNeural" });
    expect(provider!.getDefaultVoice("आप कैसे हैं?")).toBe("hi-IN-MadhurNeural");
    expect(provider!.getDefaultVoice("How are you?")).toBe("en-US-AriaNeural");
  });

  it("builds nothing when spoken replies are switched off, so the routes can say so", () => {
    expect(buildTtsProvider({ ttsProvider: "none" })).toBeNull();
  });
});

describe("pcmToWav", () => {
  it("wraps 24 kHz 16-bit mono PCM in a header any player reads", () => {
    const pcm = pcmTone(0.25);
    const wav = pcmToWav(pcm);
    expect(TTS_SAMPLE_RATE).toBe(24_000);
    expect(wav.length).toBe(44 + pcm.length);
    expect(parseWav(wav)).toMatchObject({ sampleRate: 24_000, channels: 1, bits: 16 });
    expect(parseWav(wav).pcm.equals(pcm)).toBe(true);
    expect(wav.readUInt32LE(28)).toBe(48_000); // byte rate
    expect(wav.readUInt16LE(32)).toBe(2); // block align
  });

  it("can describe another rate, and empty audio", () => {
    expect(pcmToWav(Buffer.alloc(0)).length).toBe(44);
    expect(pcmToWav(Buffer.alloc(4), 16_000).readUInt32LE(24)).toBe(16_000);
  });
});
