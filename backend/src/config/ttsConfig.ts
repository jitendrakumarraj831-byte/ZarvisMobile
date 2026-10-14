import { logger, registerSecret } from "../security/redact.js";
import { EdgeTtsProvider } from "../tts/edgeTtsProvider.js";
import { FallbackTtsProvider } from "../tts/fallbackTtsProvider.js";
import { DEFAULT_GEMINI_TTS_MODEL, DEFAULT_GEMINI_TTS_VOICE, GeminiTtsProvider } from "../tts/geminiTtsProvider.js";
import type { TtsProvider } from "../tts/provider.js";
import { DEFAULT_ENGLISH_VOICE, DEFAULT_HINDI_VOICE, isVoiceName, type VoiceSettings } from "../tts/voices.js";

/** The raw settings (a subset of `env`, so tests can pass their own). */
export interface TtsConfigInput {
  /** `edge` (default), `gemini` (Gemini's voice only) or `none`. */
  ttsProvider?: string;
  /** What speaks when Edge fails before any sound: `gemini` (default, needs GEMINI_API_KEY) or `none`. */
  ttsFallbackProvider?: string;
  ttsHindiVoice?: string;
  ttsEnglishVoice?: string;
  ttsHinglishVoice?: string;
  /** Gemini's voice: the key (the same one chat uses), the model and the prebuilt voice name. */
  geminiApiKey?: string;
  geminiTtsModel?: string;
  geminiTtsVoice?: string;
}

export interface ResolvedTtsConfig {
  provider: "edge" | "gemini" | "none";
  /** Only used with `provider: "edge"`. Whether it is available also depends on GEMINI_API_KEY (see `buildTtsProvider`). */
  fallback: "gemini" | "none";
  voices: VoiceSettings;
  gemini: { model: string; voice: string };
}

/** The model Google retired for new API users; an old deployment variable that still names it is replaced. */
const RETIRED_GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const GEMINI_VOICE_NAME = /^[A-Za-z][A-Za-z0-9_-]{1,31}$/;

function voiceSetting(name: string, value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  if (isVoiceName(trimmed)) return trimmed;
  logger.warn(`${name} must look like hi-IN-SwaraNeural; using ${fallback}`);
  return fallback;
}

/**
 * Settings are read once. A value that is not understood is reported and replaced by the default:
 * a typo in a voice name is not worth stopping the whole server for (the voice is the one part of
 * a reply that is optional). Only the variable's name is logged, never what was typed.
 */
export function resolveTtsConfig(input: TtsConfigInput): ResolvedTtsConfig {
  const wanted = input.ttsProvider?.trim().toLowerCase();
  let provider: ResolvedTtsConfig["provider"] = "edge";
  if (wanted === "none" || wanted === "gemini") provider = wanted;
  else if (wanted && wanted !== "edge") logger.warn('TTS_PROVIDER must be "edge", "gemini" or "none"; using "edge"');

  const fallbackWanted = input.ttsFallbackProvider?.trim().toLowerCase();
  let fallback: ResolvedTtsConfig["fallback"] = "gemini";
  if (fallbackWanted === "none") fallback = "none";
  else if (fallbackWanted && fallbackWanted !== "gemini") logger.warn('TTS_FALLBACK_PROVIDER must be "gemini" or "none"; using "gemini"');

  const hindi = voiceSetting("TTS_HI_VOICE", input.ttsHindiVoice, DEFAULT_HINDI_VOICE);
  const english = voiceSetting("TTS_EN_VOICE", input.ttsEnglishVoice, DEFAULT_ENGLISH_VOICE);
  const hinglish = voiceSetting("TTS_HINGLISH_VOICE", input.ttsHinglishVoice, hindi);

  const model = input.geminiTtsModel?.trim();
  const geminiVoice = input.geminiTtsVoice?.trim();
  let voice = DEFAULT_GEMINI_TTS_VOICE;
  if (geminiVoice) {
    if (GEMINI_VOICE_NAME.test(geminiVoice)) voice = geminiVoice;
    else logger.warn(`GEMINI_TTS_VOICE must be a Gemini voice name such as ${DEFAULT_GEMINI_TTS_VOICE}; using ${DEFAULT_GEMINI_TTS_VOICE}`);
  }
  return {
    provider,
    fallback,
    voices: { hindi, english, hinglish },
    gemini: { model: !model || model === RETIRED_GEMINI_TTS_MODEL ? DEFAULT_GEMINI_TTS_MODEL : model, voice },
  };
}

/**
 * The voice for this configuration; `null` when spoken replies are switched off (the route then says so with a 503).
 * By default Edge speaks and, when GEMINI_API_KEY is set, Gemini's voice answers if Edge fails before any sound.
 */
export function buildTtsProvider(input: TtsConfigInput): TtsProvider | null {
  const config = resolveTtsConfig(input);
  if (config.provider === "none") return null;

  const key = input.geminiApiKey?.trim();
  registerSecret(key);
  const gemini = key ? new GeminiTtsProvider({ apiKey: key, model: config.gemini.model, voice: config.gemini.voice }) : undefined;
  const edge = new EdgeTtsProvider({ voices: config.voices });

  if (config.provider === "gemini") {
    if (gemini) return gemini;
    logger.warn('TTS_PROVIDER="gemini" needs GEMINI_API_KEY; using "edge"');
    return edge;
  }
  return gemini && config.fallback === "gemini" ? new FallbackTtsProvider(edge, gemini) : edge;
}
