import { logger } from "../security/redact.js";
import { EdgeTtsProvider } from "../tts/edgeTtsProvider.js";
import type { TtsProvider } from "../tts/provider.js";
import { DEFAULT_ENGLISH_VOICE, DEFAULT_HINDI_VOICE, isVoiceName, type VoiceSettings } from "../tts/voices.js";

/** The raw settings (a subset of `env`, so tests can pass their own). */
export interface TtsConfigInput {
  /** `edge` (default) or `none`. */
  ttsProvider?: string;
  ttsHindiVoice?: string;
  ttsEnglishVoice?: string;
  ttsHinglishVoice?: string;
}

export interface ResolvedTtsConfig {
  provider: "edge" | "none";
  voices: VoiceSettings;
}

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
 * a reply that is optional). `TTS_PROVIDER=gemini`, from before the move to Edge's voices, is
 * reported the same way.
 */
export function resolveTtsConfig(input: TtsConfigInput): ResolvedTtsConfig {
  const wanted = input.ttsProvider?.trim().toLowerCase();
  let provider: "edge" | "none" = "edge";
  if (wanted === "none") provider = "none";
  else if (wanted && wanted !== "edge") logger.warn('TTS_PROVIDER must be "edge" or "none"; using "edge"');

  const hindi = voiceSetting("TTS_HI_VOICE", input.ttsHindiVoice, DEFAULT_HINDI_VOICE);
  const english = voiceSetting("TTS_EN_VOICE", input.ttsEnglishVoice, DEFAULT_ENGLISH_VOICE);
  const hinglish = voiceSetting("TTS_HINGLISH_VOICE", input.ttsHinglishVoice, hindi);
  return { provider, voices: { hindi, english, hinglish } };
}

/** The voice for this configuration; `null` when spoken replies are switched off (the route then says so with a 503). */
export function buildTtsProvider(input: TtsConfigInput): TtsProvider | null {
  const config = resolveTtsConfig(input);
  return config.provider === "none" ? null : new EdgeTtsProvider({ voices: config.voices });
}
