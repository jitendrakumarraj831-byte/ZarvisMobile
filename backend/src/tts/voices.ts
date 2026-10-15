/**
 * Which voice speaks a piece of text. Every voice name lives in this file or in the environment
 * (`TTS_HI_VOICE`, `TTS_EN_VOICE`, `TTS_HINGLISH_VOICE`, resolved by `config/ttsConfig.ts`); no
 * other file spells one.
 *
 * ZARVIS speaks Hindi, English and Hinglish (Hindi written in Latin letters). The language is
 * detected from the text itself, locally and instantly: no network call, no other service.
 *
 * - Devanagari anywhere in the text: Hindi voice (the same rule the web client always used).
 * - Latin letters only, with enough common Hindi words (`aaj kya karna hai`): the Hinglish voice.
 *   Every neural voice reads Latin letters with English letter-to-sound rules, so there is no
 *   perfect choice; it defaults to the Hindi voice (one speaker for everything Hindi) and
 *   `TTS_HINGLISH_VOICE` changes it (for example to `en-IN-NeerjaNeural`, an Indian-English voice).
 * - Anything else: English voice.
 *
 * A caller can name a voice (`voice` in the request). That is honoured only for a voice on the
 * allow-list below, because the name goes into the SSML sent to the service; anything else is
 * ignored and the voice is chosen from the text, as an unknown voice always was.
 */

export type SpeechLanguage = "hi" | "en" | "hinglish";

export interface VoiceSettings {
  hindi: string;
  english: string;
  /** Hindi written in Latin letters. */
  hinglish: string;
}

export const DEFAULT_HINDI_VOICE = "hi-IN-SwaraNeural";
export const DEFAULT_ENGLISH_VOICE = "en-US-JennyNeural";

/** Edge voice short names: `hi-IN-SwaraNeural`, `en-US-JennyNeural`, `fil-PH-AngeloNeural`. */
const VOICE_NAME = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/;

export function isVoiceName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && VOICE_NAME.test(value);
}

/** `hi-IN-SwaraNeural` → `hi-IN`. */
export function voiceLocale(voice: string): string {
  return voice.split("-").slice(0, 2).join("-");
}

/**
 * Voices a request may name. The configured voices are always allowed as well. Whether each one
 * exists on the service is checked by the opt-in live test, not assumed here.
 */
export const KNOWN_EDGE_VOICES: readonly string[] = [
  "hi-IN-SwaraNeural",
  "hi-IN-MadhurNeural",
  "en-US-JennyNeural",
  "en-US-GuyNeural",
  "en-US-AriaNeural",
  "en-IN-NeerjaNeural",
  "en-IN-PrabhatNeural",
];

/** The male voice that goes with a locale's usual (female) voice. */
const MALE_COUNTERPART: Readonly<Record<string, string>> = {
  "hi-IN": "hi-IN-MadhurNeural",
  "en-US": "en-US-GuyNeural",
  "en-IN": "en-IN-PrabhatNeural",
};

/**
 * Clients (the web voice picker, Android's saved preference) were built for five Gemini voice
 * names and still send one of them. They are kept working as a choice of style: the first two
 * mean "the usual voice", the other three "a male voice", in whichever language the text is.
 */
const LEGACY_STYLES: Readonly<Record<string, "default" | "male">> = {
  Kore: "default",
  Aoede: "default",
  Puck: "male",
  Charon: "male",
  Fenrir: "male",
};

/**
 * Common Hindi words as they are typed in Latin letters. Words that are also English words
 * (`main`, `to`, `me`, `do`, `hi`, `the`, `band`, `mat`, `par`, `ho`) are left out on purpose, so
 * an English sentence is not taken for Hinglish.
 */
const ROMAN_HINDI_WORDS = new Set([
  "hai", "hain", "hoon", "hun", "hoga", "hogi", "honge", "tha", "thi", "thaa", "raha", "rahi", "rahe", "rahega",
  "karna", "karo", "karke", "karenge", "kijiye", "kijiyega", "kiya", "kiye", "kya", "kyun", "kyon", "kyunki",
  "kaise", "kaisa", "kaisi", "kaun", "kab", "kahan", "kidhar", "kitna", "kitni", "kitne",
  "aap", "aapko", "aapka", "aapki", "aapke", "tum", "tumhe", "tumhara", "tumhari", "mujhe", "mera", "meri", "mere",
  "hum", "hamara", "hamari", "humein", "unko", "usko", "isko", "yeh", "woh", "kuch", "koi", "sab", "sabhi",
  "bahut", "bohot", "bahot", "thoda", "zyada", "jyada", "accha", "achha", "acha", "theek", "thik", "sahi", "galat",
  "nahi", "nahin", "nhi", "haan", "ji", "bhai", "yaar", "dost", "abhi", "aaj", "kal", "parso", "phir", "fir",
  "lekin", "magar", "aur", "toh", "bhi", "ka", "ki", "ke", "ko", "se", "mein",
  "wala", "wali", "wale", "chahiye", "chahta", "chahti", "samajh", "matlab", "batao", "bataiye", "bolo", "dekho",
  "suno", "chalo", "ruko", "likho", "padho", "kholo", "lagta", "lagti", "gaya", "gayi", "gaye", "diya", "diye",
  "liya", "liye", "hua", "hui", "hue", "namaste", "namaskar", "dhanyavad", "shukriya", "kripya", "jaldi", "pehle",
  "baad", "saath", "andar", "bahar", "kaam", "paisa", "paise", "samay", "subah", "shaam", "raat",
]);

const DEVANAGARI = /\p{Script=Devanagari}/u;

export function detectSpeechLanguage(text: string): SpeechLanguage {
  if (DEVANAGARI.test(text)) return "hi";
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length === 0) return "en";
  const hindi = words.filter((word) => ROMAN_HINDI_WORDS.has(word)).length;
  // Two or more Hindi words that make up a fair share of the sentence; or a very short phrase
  // that is Hindi (`haan ji`, `theek hai`, `kal`).
  if ((hindi >= 2 && hindi / words.length >= 0.2) || (hindi >= 1 && words.length <= 3)) return "hinglish";
  return "en";
}

export function voiceForLanguage(language: SpeechLanguage, settings: VoiceSettings): string {
  return language === "hi" ? settings.hindi : language === "hinglish" ? settings.hinglish : settings.english;
}

export function allowedVoices(settings: VoiceSettings): ReadonlySet<string> {
  return new Set([...KNOWN_EDGE_VOICES, settings.hindi, settings.english, settings.hinglish]);
}

export interface ResolvedVoice {
  voice: string;
  /** The voice's own locale (`hi-IN`), used for the SSML `xml:lang`. */
  locale: string;
  language: SpeechLanguage;
  /** `explicit`: the caller named an allowed voice. `style`: a legacy style name. `auto`: from the text. */
  source: "explicit" | "style" | "auto";
}

export function resolveVoice(text: string, requested: unknown, settings: VoiceSettings): ResolvedVoice {
  const language = detectSpeechLanguage(text);
  const automatic = voiceForLanguage(language, settings);

  if (typeof requested === "string" && isVoiceName(requested) && allowedVoices(settings).has(requested)) {
    return { voice: requested, locale: voiceLocale(requested), language, source: "explicit" };
  }
  if (typeof requested === "string" && Object.hasOwn(LEGACY_STYLES, requested)) {
    const male = LEGACY_STYLES[requested] === "male" ? MALE_COUNTERPART[voiceLocale(automatic)] : undefined;
    const voice = male ?? automatic;
    return { voice, locale: voiceLocale(voice), language, source: "style" };
  }
  return { voice: automatic, locale: voiceLocale(automatic), language, source: "auto" };
}
