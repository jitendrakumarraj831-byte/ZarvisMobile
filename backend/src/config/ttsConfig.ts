import { logger, registerSecret } from "../security/redact.js";
import { EdgeTtsProvider } from "../tts/edgeTtsProvider.js";
import { FallbackTtsProvider } from "../tts/fallbackTtsProvider.js";
import { DEFAULT_GEMINI_TTS_MODEL, DEFAULT_GEMINI_TTS_VOICE, GeminiTtsProvider } from "../tts/geminiTtsProvider.js";
import type { TtsProvider } from "../tts/provider.js";
import { DEFAULT_ENGLISH_VOICE, DEFAULT_HINDI_VOICE, isVoiceName, type VoiceSettings } from "../tts/voices.js";

/** The raw settings (a subset of `env`, so tests can pass their own). */
export interface TtsConfigInput {
  /** `gemini` (default: Gemini's voice first, Edge behind it), `edge` (Edge first, Gemini behind it) or `none`. */
  ttsProvider?: string;
  /**
   * What speaks when the main voice fails before any sound. With `TTS_PROVIDER=gemini` (default): `edge` (default) or
   * `none` (Gemini alone). With `TTS_PROVIDER=edge`: `gemini` (default, needs GEMINI_API_KEY) or `none`.
   */
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
  /**
   * The second voice: `edge` behind Gemini, `gemini` behind Edge, or `none`. Never the same engine as `provider`.
   * Whether it is available also depends on GEMINI_API_KEY (see `buildTtsProvider`).
   */
  fallback: "gemini" | "edge" | "none";
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
  let provider: ResolvedTtsConfig["provider"] = "gemini";
  if (wanted === "none" || wanted === "edge") provider = wanted;
  else if (wanted && wanted !== "gemini") logger.warn('TTS_PROVIDER must be "gemini", "edge" or "none"; using "gemini"');

  // The second voice is always the other engine: Edge behind Gemini (the default), or Gemini behind Edge.
  // `TTS_FALLBACK_PROVIDER=none` keeps the main voice alone.
  const fallbackWanted = input.ttsFallbackProvider?.trim().toLowerCase();
  const other = provider === "gemini" ? "edge" : "gemini";
  let fallback: ResolvedTtsConfig["fallback"] = other;
  if (fallbackWanted === "none" || fallbackWanted === other) fallback = fallbackWanted;
  else if (fallbackWanted) logger.warn(`TTS_FALLBACK_PROVIDER must be "${other}" or "none" with TTS_PROVIDER="${provider}"; using "${fallback}"`);

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
 * By default Gemini's voice speaks (when GEMINI_API_KEY is set) and Edge answers if it fails before any sound; without
 * the key Edge speaks alone. With TTS_PROVIDER=edge Edge speaks and Gemini's voice answers if Edge fails before any sound.
 */
export function buildTtsProvider(input: TtsConfigInput): TtsProvider | null {
  const config = resolveTtsConfig(input);
  if (config.provider === "none") return null;

  const key = input.geminiApiKey?.trim();
  registerSecret(key);
  const gemini = key ? new GeminiTtsProvider({ apiKey: key, model: config.gemini.model, voice: config.gemini.voice }) : undefined;
  const edge = new EdgeTtsProvider({ voices: config.voices });

  if (config.provider === "gemini") {
    if (gemini) return config.fallback === "edge" ? new FallbackTtsProvider(gemini, edge) : gemini;
    // Only an explicit choice is worth a warning; the default quietly uses Edge's keyless voice.
    if (input.ttsProvider?.trim()) logger.warn('TTS_PROVIDER="gemini" needs GEMINI_API_KEY; using "edge"');
    return edge;
  }
  return gemini && config.fallback === "gemini" ? new FallbackTtsProvider(edge, gemini) : edge;
}
