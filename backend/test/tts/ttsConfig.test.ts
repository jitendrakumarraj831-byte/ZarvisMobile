import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTtsProvider, resolveTtsConfig } from "../../src/config/ttsConfig.js";
import { EdgeTtsProvider } from "../../src/tts/edgeTtsProvider.js";
import { FallbackTtsProvider } from "../../src/tts/fallbackTtsProvider.js";
import { DEFAULT_GEMINI_TTS_MODEL, GeminiTtsProvider } from "../../src/tts/geminiTtsProvider.js";
import { logger } from "../../src/security/redact.js";
import { pcmToWav, TTS_SAMPLE_RATE } from "../../src/tts/wav.js";
import { parseWav, pcmTone } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

describe("resolveTtsConfig", () => {
  it("defaults to Gemini with Edge behind it, with Swara for Hindi, Jenny for English, and the Hindi voice for Hinglish", () => {
    expect(resolveTtsConfig({})).toEqual({
      provider: "gemini",
      fallback: "edge",
      voices: { hindi: "hi-IN-SwaraNeural", english: "en-US-JennyNeural", hinglish: "hi-IN-SwaraNeural" },
      gemini: { model: DEFAULT_GEMINI_TTS_MODEL, voice: "Kore" },
    });
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

  it("accepts the provider in any case, `gemini` for Gemini's voice alone, and `none` switches spoken replies off", () => {
    expect(resolveTtsConfig({ ttsProvider: "EDGE" }).provider).toBe("edge");
    expect(resolveTtsConfig({ ttsProvider: "Gemini" }).provider).toBe("gemini");
    expect(resolveTtsConfig({ ttsProvider: " none " }).provider).toBe("none");
  });

  it("reports a provider it does not know and uses the default (Gemini) instead of stopping the server", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    for (const value of ["google_cloud", "azure", "true"]) expect(resolveTtsConfig({ ttsProvider: value }).provider).toBe("gemini");
    expect(warn).toHaveBeenCalledTimes(3);
    expect(String(warn.mock.calls[0]![0])).toContain("TTS_PROVIDER");
  });

  it("reads the fallback setting: `edge` by default, `none` switches it off, anything else is reported and ignored", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    expect(resolveTtsConfig({}).fallback).toBe("edge");
    expect(resolveTtsConfig({ ttsFallbackProvider: " NONE " }).fallback).toBe("none");
    expect(resolveTtsConfig({ ttsFallbackProvider: "" }).fallback).toBe("edge");
    expect(warn).not.toHaveBeenCalled();
    expect(resolveTtsConfig({ ttsFallbackProvider: "azure" }).fallback).toBe("edge");
    expect(String(warn.mock.calls[0]![0])).toContain("TTS_FALLBACK_PROVIDER");
  });

  it("the second voice is the other engine by default: Edge behind Gemini, Gemini behind Edge", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    expect(resolveTtsConfig({ ttsProvider: "gemini" }).fallback).toBe("edge");
    expect(resolveTtsConfig({ ttsProvider: "edge" }).fallback).toBe("gemini");
    expect(resolveTtsConfig({ ttsProvider: "gemini", ttsFallbackProvider: " Edge " }).fallback).toBe("edge");
    expect(resolveTtsConfig({ ttsProvider: "gemini", ttsFallbackProvider: "none" }).fallback).toBe("none");
    expect(warn).not.toHaveBeenCalled();
    // "gemini" behind Gemini, and "edge" behind Edge, make no sense: reported, and the default for that main voice is used.
    expect(resolveTtsConfig({ ttsProvider: "gemini", ttsFallbackProvider: "gemini" }).fallback).toBe("edge");
    expect(resolveTtsConfig({ ttsProvider: "edge", ttsFallbackProvider: "edge" }).fallback).toBe("gemini");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]![0])).toContain('TTS_FALLBACK_PROVIDER must be "edge" or "none" with TTS_PROVIDER="gemini"');
  });

  it("reads Gemini's voice model and voice, replaces the model Google retired, and reports a voice name that is not one", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    expect(resolveTtsConfig({ geminiTtsModel: "gemini-3.8-flash-tts", geminiTtsVoice: "Puck" }).gemini).toEqual({ model: "gemini-3.8-flash-tts", voice: "Puck" });
    expect(resolveTtsConfig({ geminiTtsModel: "gemini-2.5-flash-preview-tts" }).gemini.model).toBe(DEFAULT_GEMINI_TTS_MODEL);
    expect(resolveTtsConfig({ geminiTtsModel: "   " }).gemini.model).toBe(DEFAULT_GEMINI_TTS_MODEL);
    expect(warn).not.toHaveBeenCalled();
    expect(resolveTtsConfig({ geminiTtsVoice: "not a voice!" }).gemini.voice).toBe("Kore");
    expect(String(warn.mock.calls[0]![0])).toContain("GEMINI_TTS_VOICE");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("not a voice!");
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
  it("builds the Edge voice alone when there is no Gemini key, and needs no key to do it (quietly: the default asked for nothing)", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const provider = buildTtsProvider({});
    expect(warn).not.toHaveBeenCalled();
    expect(provider).toBeInstanceOf(EdgeTtsProvider);
    expect(provider!.id).toBe("edge");
    expect(provider!.getDefaultVoice("How are you?")).toBe("en-US-JennyNeural");
    expect(provider!.getDefaultVoice("आप कैसे हैं?")).toBe("hi-IN-SwaraNeural");
  });

  it("builds it with the configured voices", () => {
    const provider = buildTtsProvider({ ttsProvider: "edge", ttsHindiVoice: "hi-IN-MadhurNeural", ttsEnglishVoice: "en-US-AriaNeural" });
    expect(provider!.getDefaultVoice("आप कैसे हैं?")).toBe("hi-IN-MadhurNeural");
    expect(provider!.getDefaultVoice("How are you?")).toBe("en-US-AriaNeural");
  });

  it("builds nothing when spoken replies are switched off, so the routes can say so", () => {
    expect(buildTtsProvider({ ttsProvider: "none" })).toBeNull();
    expect(buildTtsProvider({ ttsProvider: "none", geminiApiKey: "k" })).toBeNull();
  });

  it("by default puts Gemini's voice first with Edge's behind it when there is a key, and reports itself as Gemini", () => {
    const provider = buildTtsProvider({ geminiApiKey: "test-key-1234567890", geminiTtsVoice: "Puck" });
    expect(provider).toBeInstanceOf(FallbackTtsProvider);
    expect(provider!.id).toBe("gemini");
    expect(provider!.getDefaultVoice()).toBe("gemini:Puck");
  });

  it("puts Gemini's voice behind Edge's with TTS_PROVIDER=edge, and still reports itself as Edge", () => {
    const provider = buildTtsProvider({ ttsProvider: "edge", geminiApiKey: "test-key-1234567890" });
    expect(provider).toBeInstanceOf(FallbackTtsProvider);
    expect(provider!.id).toBe("edge");
    expect(provider!.getDefaultVoice("आप कैसे हैं?")).toBe("hi-IN-SwaraNeural");
  });

  it("keeps Edge alone when the fallback is off, when there is no key, or when the key is blank", () => {
    expect(buildTtsProvider({ ttsProvider: "edge", geminiApiKey: "test-key-1234567890", ttsFallbackProvider: "none" })).toBeInstanceOf(EdgeTtsProvider);
    expect(buildTtsProvider({ ttsProvider: "edge" })).toBeInstanceOf(EdgeTtsProvider);
    expect(buildTtsProvider({ ttsProvider: "edge", geminiApiKey: "   " })).toBeInstanceOf(EdgeTtsProvider);
    expect(buildTtsProvider({ geminiApiKey: "   " })).toBeInstanceOf(EdgeTtsProvider);
  });

  it("puts Edge behind Gemini's voice when asked explicitly, and reports itself as Gemini", () => {
    const provider = buildTtsProvider({ ttsProvider: "gemini", ttsFallbackProvider: "edge", geminiApiKey: "test-key-1234567890", geminiTtsVoice: "Puck" });
    expect(provider).toBeInstanceOf(FallbackTtsProvider);
    expect(provider!.id).toBe("gemini");
    expect(provider!.getDefaultVoice()).toBe("gemini:Puck");
    // TTS_FALLBACK_PROVIDER=none: Gemini speaks alone and the text goes nowhere else.
    expect(buildTtsProvider({ ttsProvider: "gemini", ttsFallbackProvider: "none", geminiApiKey: "test-key-1234567890" })).toBeInstanceOf(GeminiTtsProvider);
  });

  it("builds Gemini's voice alone when asked, and says so (and uses Edge) when it has no key to do it with", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const alone = buildTtsProvider({ ttsProvider: "gemini", ttsFallbackProvider: "none", geminiApiKey: "test-key-1234567890", geminiTtsVoice: "Puck" });
    expect(alone).toBeInstanceOf(GeminiTtsProvider);
    expect(alone!.getDefaultVoice()).toBe("gemini:Puck");
    expect(warn).not.toHaveBeenCalled();

    expect(buildTtsProvider({ ttsProvider: "gemini" })).toBeInstanceOf(EdgeTtsProvider);
    expect(String(warn.mock.calls[0]![0])).toContain("GEMINI_API_KEY");
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
