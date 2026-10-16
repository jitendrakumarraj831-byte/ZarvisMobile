import { KeyRotator, parseKeyList } from "../security/keyRotator.js";
import { logger, registerSecret } from "../security/redact.js";
import { EdgeTtsProvider } from "../tts/edgeTtsProvider.js";
import { FallbackTtsProvider } from "../tts/fallbackTtsProvider.js";
import { DEFAULT_ELEVENLABS_MODEL, DEFAULT_ELEVENLABS_VOICE_ID, ElevenLabsTtsProvider } from "../tts/elevenLabsTtsProvider.js";
import { DEFAULT_GEMINI_TTS_MODEL, DEFAULT_GEMINI_TTS_VOICE, GeminiTtsProvider } from "../tts/geminiTtsProvider.js";
import { Semaphore } from "../tts/guard.js";
import { KeyRotatingTtsProvider } from "../tts/keyRotatingTtsProvider.js";
import type { TtsProvider } from "../tts/provider.js";
import { DEFAULT_ENGLISH_VOICE, DEFAULT_HINDI_VOICE, isVoiceName, type VoiceSettings } from "../tts/voices.js";

/** The raw settings (a subset of `env`, so tests can pass their own). */
export interface TtsConfigInput {
  /**
   * The main voice: `elevenlabs`, `gemini`, `edge`, or `none` (no spoken replies). Unset: ElevenLabs when it has
   * a key (ELEVENLABS_KEYS / ELEVENLABS_API_KEY), otherwise Gemini.
   */
  ttsProvider?: string;
  /**
   * The voices asked, in order, when the one before fails before any sound: a comma-separated chain such as
   * `gemini,edge`, or `none`. Default: `edge` behind Gemini, `gemini` behind Edge, `gemini,edge` behind ElevenLabs.
   */
  ttsFallbackProvider?: string;
  ttsHindiVoice?: string;
  ttsEnglishVoice?: string;
  ttsHinglishVoice?: string;
  /** Gemini's voice: the key (the same one chat uses), the model and the prebuilt voice name. */
  geminiApiKey?: string;
  geminiTtsModel?: string;
  geminiTtsVoice?: string;
  /**
   * ElevenLabs' voice: its keys (the list, then the single key, each once; with several, the next key speaks when
   * one is rate limited, out of characters or refused), the voice id and the model.
   */
  elevenLabsKeys?: readonly string[];
  elevenLabsApiKey?: string;
  elevenLabsVoiceId?: string;
  elevenLabsModel?: string;
}

export type TtsEngine = "gemini" | "elevenlabs" | "edge";
const ENGINES: readonly TtsEngine[] = ["gemini", "elevenlabs", "edge"];

export interface ResolvedTtsConfig {
  provider: TtsEngine | "none";
  /** The first voice behind the main one, or `none`. Kept for readers that know only one fallback. */
  fallback: TtsEngine | "none";
  /**
   * Every voice behind the main one, in the order they are asked. Never the main engine. Whether each is
   * available also depends on its key (see `buildTtsProvider`): a voice without one is skipped.
   */
  fallbacks: TtsEngine[];
  voices: VoiceSettings;
  gemini: { model: string; voice: string };
  elevenLabs: { model: string; voiceId: string };
}

/** The model Google retired for new API users; an old deployment variable that still names it is replaced. */
const RETIRED_GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const GEMINI_VOICE_NAME = /^[A-Za-z][A-Za-z0-9_-]{1,31}$/;
/** ElevenLabs voice ids are short alphanumeric strings; model ids are lower-case words with underscores. */
const ELEVENLABS_VOICE_ID = /^[A-Za-z0-9]{8,64}$/;
const ELEVENLABS_MODEL_ID = /^[a-z0-9][a-z0-9_.-]{1,63}$/;

/** The default chain behind each main voice. */
function defaultFallbacks(provider: TtsEngine): TtsEngine[] {
  if (provider === "gemini") return ["edge"];
  if (provider === "edge") return ["gemini"];
  return ["gemini", "edge"];
}

function voiceSetting(name: string, value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  if (isVoiceName(trimmed)) return trimmed;
  logger.warn(`${name} must look like hi-IN-SwaraNeural; using ${fallback}`);
  return fallback;
}

function patternSetting(name: string, value: string | undefined, pattern: RegExp, fallback: string, example: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  if (pattern.test(trimmed)) return trimmed;
  logger.warn(`${name} must look like ${example}; using ${fallback}`);
  return fallback;
}

/**
 * Settings are read once. A value that is not understood is reported and replaced by the default:
 * a typo in a voice name is not worth stopping the whole server for (the voice is the one part of
 * a reply that is optional). Only the variable's name is logged, never what was typed.
 */
export function resolveTtsConfig(input: TtsConfigInput): ResolvedTtsConfig {
  const wanted = input.ttsProvider?.trim().toLowerCase();
  // ElevenLabs speaks first once it has a key; a deployment without one keeps Gemini's voice first.
  let provider: ResolvedTtsConfig["provider"] = elevenLabsKeysOf(input).length > 0 ? "elevenlabs" : "gemini";
  if (wanted === "none" || (ENGINES as readonly string[]).includes(wanted ?? "")) provider = wanted as ResolvedTtsConfig["provider"];
  else if (wanted) logger.warn(`TTS_PROVIDER must be "gemini", "elevenlabs", "edge" or "none"; using "${provider}"`);

  // The chain behind the main voice: each engine at most once, never the main one. `none` keeps the main voice alone.
  let fallbacks: TtsEngine[] = provider === "none" ? [] : defaultFallbacks(provider);
  const chainWanted = input.ttsFallbackProvider?.trim().toLowerCase();
  if (chainWanted && provider !== "none") {
    const tokens = chainWanted.split(/[\s,]+/).filter(Boolean);
    const others = ENGINES.filter((engine) => engine !== provider);
    if (tokens.length === 1 && tokens[0] === "none") fallbacks = [];
    else if (tokens.every((token) => (others as readonly string[]).includes(token))) fallbacks = [...new Set(tokens)] as TtsEngine[];
    else {
      logger.warn(
        `TTS_FALLBACK_PROVIDER must list voices other than TTS_PROVIDER="${provider}" (${others.map((engine) => `"${engine}"`).join(", ")}), in order, or be "none"; using "${fallbacks.join(",") || "none"}"`,
      );
    }
  }

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
    fallback: fallbacks[0] ?? "none",
    fallbacks,
    voices: { hindi, english, hinglish },
    gemini: { model: !model || model === RETIRED_GEMINI_TTS_MODEL ? DEFAULT_GEMINI_TTS_MODEL : model, voice },
    elevenLabs: {
      model: patternSetting("ELEVENLABS_MODEL", input.elevenLabsModel, ELEVENLABS_MODEL_ID, DEFAULT_ELEVENLABS_MODEL, DEFAULT_ELEVENLABS_MODEL),
      voiceId: patternSetting("ELEVENLABS_VOICE_ID", input.elevenLabsVoiceId, ELEVENLABS_VOICE_ID, DEFAULT_ELEVENLABS_VOICE_ID, DEFAULT_ELEVENLABS_VOICE_ID),
    },
  };
}

/** The variable each keyed engine needs. */
const KEY_NAME: Partial<Record<TtsEngine, string>> = { gemini: "GEMINI_KEYS or GEMINI_API_KEY", elevenlabs: "ELEVENLABS_KEYS or ELEVENLABS_API_KEY" };

function elevenLabsKeysOf(input: Pick<TtsConfigInput, "elevenLabsKeys" | "elevenLabsApiKey">): string[] {
  return parseKeyList(input.elevenLabsKeys, input.elevenLabsApiKey);
}

/**
 * The voice for this configuration; `null` when spoken replies are switched off (the route then says so with a 503).
 * The main voice speaks; when it fails before any sound the next voice in the chain says the same text, and so on
 * (each a `FallbackTtsProvider` hop: never in the middle of a reply, never back). A voice without its key is skipped,
 * and when no voice is left, Edge's keyless voice speaks. By default: ElevenLabs (when it has a key), then Gemini,
 * then Edge; without an ElevenLabs key, Gemini then Edge.
 *
 * With several ElevenLabs keys the ElevenLabs voice is a `KeyRotatingTtsProvider`: a key that is out of characters,
 * rate limited or refused hands the sentence to the next key before the chain moves on to the next voice.
 */
export function buildTtsProvider(input: TtsConfigInput): TtsProvider | null {
  const config = resolveTtsConfig(input);
  if (config.provider === "none") return null;

  const geminiKey = input.geminiApiKey?.trim();
  const elevenLabsKeys = elevenLabsKeysOf(input);
  registerSecret(geminiKey);
  for (const key of elevenLabsKeys) registerSecret(key);
  // One in-flight limit for every ElevenLabs key: more keys must not mean more syntheses held open here.
  const elevenLabsSlots = new Semaphore(8, 16);
  const elevenLabs = (key: string) =>
    new ElevenLabsTtsProvider({ apiKey: key, voiceId: config.elevenLabs.voiceId, model: config.elevenLabs.model, slots: elevenLabsSlots });
  const build = (engine: TtsEngine): TtsProvider | undefined => {
    if (engine === "edge") return new EdgeTtsProvider({ voices: config.voices });
    if (engine === "gemini") return geminiKey ? new GeminiTtsProvider({ apiKey: geminiKey, model: config.gemini.model, voice: config.gemini.voice }) : undefined;
    if (elevenLabsKeys.length === 0) return undefined;
    if (elevenLabsKeys.length === 1) return elevenLabs(elevenLabsKeys[0]!);
    return new KeyRotatingTtsProvider({ id: "elevenlabs", rotator: new KeyRotator({ name: "ELEVENLABS", keys: () => elevenLabsKeys }), build: elevenLabs });
  };

  const chain: TtsProvider[] = [];
  for (const engine of [config.provider, ...config.fallbacks]) {
    const voice = build(engine);
    if (voice) chain.push(voice);
    // Only an explicit choice is worth a warning; the default quietly moves on to the next voice.
    else if (engine === config.provider && input.ttsProvider?.trim()) logger.warn(`TTS_PROVIDER="${engine}" needs ${KEY_NAME[engine]}; using the next voice`);
  }
  if (chain.length === 0) chain.push(build("edge")!);
  return chain.reduceRight((rest, voice) => new FallbackTtsProvider(voice, rest));
}
