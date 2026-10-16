/**
 * Which language a piece of text is in: Hindi (Devanagari), Hinglish (Hindi typed in Latin letters) or English.
 *
 * This is the ONE detector. The planner uses it to decide the language of a reply (`detectReplyLanguage`, from the
 * user's message) and the voice uses it to pick who speaks (`detectTextLanguage`, from the reply's text, re-exported
 * by `tts/voices.ts` as `detectSpeechLanguage`). Two detectors used to disagree: the planner's own list counted
 * English words (`the`, `do`) as Hindi and matched at most one word, so "What is the capital of France?" was answered
 * in Hindi while "WhatsApp kholo" was answered in English.
 *
 * It is local and instant: no network call, no other service.
 */

export type TextLanguage = "hi" | "en" | "hinglish";

/**
 * Common Hindi words as they are typed in Latin letters. Words that are also English words (`main`, `to`, `me`, `do`,
 * `hi`, `the`, `band`, `mat`, `par`, `ho`, `is`, `us`) are left out on purpose, so an English sentence is not taken
 * for Hinglish; so are words that are common first names (`lena`, `dena`, `jana`), so "Call Lena" stays English.
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
  // Words of everyday requests and voice commands ("mujhe 5 baje yaad dilana", "Rahul ko message bhejo").
  "kar", "kardo", "karta", "karti", "karte", "kisne", "kisko", "kiska", "kiski", "banaya", "banao", "bana",
  "yaad", "dilana", "dilao", "dila", "khol", "bhejo", "bhej", "bhejna", "rakhna", "rakho", "rakh", "sunao", "sunna",
  "padh", "padhna", "likh", "likhna", "baje", "lagao", "laga", "dijiye", "lijiye", "jao", "jaana", "jaunga", "jaungi",
  "jayega", "aana", "ghar", "mausam", "khana", "pani", "ek", "dono", "tera", "teri", "tere", "apna", "apni", "apne",
  "uska", "uski", "uske", "iska", "iski", "iske", "unka", "unki", "unke", "yahan", "wahan", "kaha", "bata", "batana",
  "poocho", "puchho", "samjhao", "sakte", "sakta", "chal", "haal", "aapse", "tumse", "mujhse", "humse", "zaroor", "jarur",
  // Spellings the planner's old list knew.
  "kyu", "kon", "tumhein", "bataye", "banai", "denge",
]);

/**
 * Common English words. They are only consulted once the text has too few Hindi words to be Hinglish: one of these
 * says the person wrote English; text with none of them ("Forbesganj", "1234") has no language, and the app language
 * breaks the tie.
 */
const ENGLISH_WORDS = new Set([
  "what", "why", "when", "where", "who", "how", "which", "can", "could", "would", "should", "will", "is", "are", "was",
  "were", "do", "does", "did", "tell", "show", "find", "search", "explain", "help", "please", "thanks", "thank", "weather",
  "today", "tomorrow", "latest", "create", "build", "design", "develop", "write", "make", "open", "call", "set", "send",
  "read", "summarize", "translate", "draft", "the", "a", "an", "of", "for", "to", "and", "or", "my", "me", "you", "your",
  "this", "that", "with", "in", "on", "it", "i", "about", "from", "yes", "no", "ok", "okay",
]);

const DEVANAGARI = /\p{Script=Devanagari}/u;

/** The Latin words of `text`, lower-cased. */
function latinWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+/g) ?? [];
}

/**
 * - Devanagari anywhere in the text: Hindi.
 * - Latin letters only, with enough common Hindi words (`aaj kya karna hai`): Hinglish. Two or more Hindi words that
 *   make up a fair share of the sentence, or a very short phrase that is Hindi (`haan ji`, `theek hai`, `kal`).
 * - Anything else: English (including text with no letters at all).
 */
export function detectTextLanguage(text: string): TextLanguage {
  if (DEVANAGARI.test(text)) return "hi";
  const words = latinWords(text);
  if (words.length === 0) return "en";
  const hindi = words.filter((word) => ROMAN_HINDI_WORDS.has(word)).length;
  if ((hindi >= 2 && hindi / words.length >= 0.2) || (hindi >= 1 && words.length <= 3)) return "hinglish";
  return "en";
}

/**
 * The language ZARVIS replies in, from the user's CURRENT message: Hindi (which covers Hinglish) when the message is
 * Hindi or Hinglish, English when it is English, and the app language (`locale`) only when the message itself says
 * nothing (a name, a number).
 */
export function detectReplyLanguage(utterance: string, locale?: string): "hi" | "en" {
  if (detectTextLanguage(utterance) !== "en") return "hi";
  if (latinWords(utterance).some((word) => ENGLISH_WORDS.has(word))) return "en";
  return locale?.toLowerCase().startsWith("hi") ? "hi" : "en";
}
