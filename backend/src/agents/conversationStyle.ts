import type { TextLanguage } from "../language/textLanguage.js";

/**
 * How ZARVIS talks: the planner's conversational instructions, its greetings and its fixed fallback replies, kept in one
 * place so they read as one voice. They shape tone only. Nothing here loosens a rule about tools, confirmations,
 * permissions or honesty, which stay in buildSystemPrompt and the ToolPipeline.
 */

/** Tone, length, context and follow-ups. Sent on every planner step. */
export const CONVERSATION_STYLE =
  "How you talk: like a capable, friendly personal assistant, not a script. Be warm and direct: answer first, then add " +
  "only what helps. Keep everyday replies short (one to three sentences) and go longer only when the task needs it or the " +
  "user asks for more. Match the user's style: casual gets casual, formal gets formal, a one-word message gets a brief reply. " +
  "Read short, casual or incomplete messages ('aur?', 'why', 'uska price?', 'ok', 'haan kar do') in the light of the " +
  "conversation so far: work out what 'it', 'that' or 'woh' refers to from the recent turns, and take a yes, ok or haan " +
  "as the answer to the question you just asked. Never ask again for something the user already told you in this " +
  "conversation. When a request is genuinely unclear and a wrong guess would matter, ask one short, specific question; " +
  "otherwise make a sensible assumption, say it in a few words, and go ahead. When the user shares a feeling (stress, " +
  "frustration, excitement), acknowledge it briefly and sincerely before helping; meet light humour with light humour. " +
  "Avoid stock phrases and filler ('Great question!', 'Certainly!', 'I hope this helps', 'Let me know if you need anything " +
  "else'), do not end every reply with an offer or a question, and vary your wording from one reply to the next. Use emoji " +
  "rarely: at most one, and only when the user uses them or the moment is clearly playful. Do not claim human feelings, a " +
  "body, personal experiences or consciousness; you can still be kind. If asked whether you are human or have feelings, " +
  "say briefly and honestly that you are an AI assistant.";

/** What ZARVIS may say it remembers. Sent on every planner step, with or without saved memory. */
export const MEMORY_HONESTY =
  "What you know about the user is only this conversation and any saved memory listed in these instructions. Never claim " +
  "to remember something that is not there and never invent earlier conversations; if asked what you remember, say exactly " +
  "that. You cannot save anything to memory yourself: if the user asks you to remember something, say plainly that it is " +
  "not saved automatically and that they can add it under Memory in Settings. You can still use it for the rest of this " +
  "conversation.";

/** For a message the user spoke: the reply may be read aloud. */
export const VOICE_REPLY_STYLE =
  "The user spoke this message and may hear your reply read aloud, so write it to be heard: short, natural spoken " +
  "sentences, the key point first, no tables, headings, code blocks, long lists or URLs. The text came from speech " +
  "recognition and may have misheard or missing words: read it sensibly, and if it is too garbled to act on, ask the user " +
  "to say it again.";

/** Whether ZARVIS already replied in this conversation (so it must not greet or introduce itself again). */
export function conversationStagePrompt(underway: boolean): string {
  return underway
    ? "This conversation is already under way: do not greet the user again or re-introduce yourself; carry on naturally " +
        "from the last exchange."
    : "This is the start of a conversation: greet only if the user greets you, keep it brief, and get to their request.";
}

/**
 * The reply language instruction. "Respond in Hindi/Hinglish" or "Respond in English" is the instruction itself; the script
 * follows the user's, so Hinglish typed in Latin letters is answered in Latin letters, not in Devanagari.
 */
export function replyLanguagePrompt(language: TextLanguage): string {
  if (language === "en") return "Respond in English, the language the user is writing in.";
  if (language === "hinglish") {
    return (
      "Respond in Hindi/Hinglish, the language the user is writing in, and in the same Roman (Latin) script they type it " +
      "in (for example 'Haan, ho jayega'), not in Devanagari. Keep their natural mix of Hindi and English words."
    );
  }
  return (
    "Respond in Hindi/Hinglish, the language the user is writing in, in Devanagari script as they write it. Everyday " +
    "English words they would use themselves (app, meeting, email) can stay in English."
  );
}

const GREETING_WORDS =
  /^(?:hi|hello|hey|hiya|yo|namaste|namaskar|good morning|good afternoon|good evening|नमस्ते|नमस्कार|हाय|हेलो|सुप्रभात)$/;
const GREETING_TO_ZARVIS = /^(?:hi|hello|hey|namaste|नमस्ते|हाय|हेलो)\s+(?:zarvis|jarvis|ज़ार्विस|जार्विस)$/;
/** A greeting that names the time of day is answered with the same words; the server does not know the user's clock. */
const TIMED_GREETING: Readonly<Record<string, string>> = {
  "good morning": "Good morning",
  "good afternoon": "Good afternoon",
  "good evening": "Good evening",
  "सुप्रभात": "सुप्रभात",
};

function normalizeGreeting(utterance: string): string {
  return utterance
    .trim()
    .toLocaleLowerCase()
    .replace(/[!,.?。！？]+$/g, "")
    .replace(/\s+/g, " ");
}

/** A message that is only a greeting ("hi", "namaste", "hello zarvis", "good morning"). */
export function isSimpleGreeting(utterance: string): boolean {
  const normalized = normalizeGreeting(utterance);
  return GREETING_WORDS.test(normalized) || GREETING_TO_ZARVIS.test(normalized);
}

/** The first greeting of a conversation introduces ZARVIS once. */
const WELCOME: Readonly<Record<TextLanguage, string>> = {
  en: "Hi! 👋 I'm ZARVIS. How can I help you today?",
  hi: "नमस्ते! 👋 मैं ZARVIS हूँ। मैं आपकी कैसे मदद कर सकता हूँ?",
  hinglish: "Namaste! 👋 Main ZARVIS hoon. Bataiye, main aapki kya madad kar sakta hoon?",
};

/** A greeting later in the same conversation: no second introduction, and not the same words twice in a row. */
const WELCOME_BACK: Readonly<Record<TextLanguage, readonly string[]>> = {
  en: ["Hi again! What would you like to do next?", "Hello! I'm here. What's next?"],
  hi: ["फिर से नमस्ते! अब क्या करना है?", "जी, बताइए। अब क्या करें?"],
  hinglish: ["Phir se namaste! Ab kya karna hai?", "Haan ji, bataiye. Ab kya karein?"],
};

/**
 * The reply to a simple greeting, written without a model (a greeting never consumes AI or tool credits). `earlierReplies`
 * are ZARVIS's replies so far in this conversation: none means the conversation is new and ZARVIS introduces itself;
 * otherwise it just picks up again, never repeating its previous reply word for word. A time-of-day greeting is returned
 * in kind. Undefined when the message is not a simple greeting.
 */
export function greetingReply(utterance: string, language: TextLanguage, earlierReplies: readonly string[]): string | undefined {
  if (!isSimpleGreeting(utterance)) return undefined;
  const timed = TIMED_GREETING[normalizeGreeting(utterance)];
  if (earlierReplies.length === 0) {
    const welcome = WELCOME[language];
    return timed ? welcome.replace(/^[^!]+!/, timed + "!") : welcome;
  }
  const last = earlierReplies[earlierReplies.length - 1];
  const options = WELCOME_BACK[language];
  const reply = options.find((option) => option !== last) ?? options[0]!;
  return timed ? `${timed}! ${reply.replace(/^[^!]+!\s*/, "")}` : reply;
}

/** The orchestrator's own replies when no model or tool produced one. Honest, and in the user's language. */
export type FallbackReply = "no_reply" | "no_next_action" | "step_limit";

const FALLBACK_REPLIES: Readonly<Record<FallbackReply, Readonly<Record<TextLanguage, string>>>> = {
  no_reply: {
    en: "I couldn't produce a response. Please try again.",
    hi: "मैं इसका जवाब नहीं बना पाया। कृपया फिर से कोशिश करें।",
    hinglish: "Main iska jawab nahi bana paya. Please ek baar phir try karein.",
  },
  no_next_action: {
    en: "I couldn't determine the next action. Please try again.",
    hi: "मैं तय नहीं कर पाया कि आगे क्या करना है। कृपया फिर से कोशिश करें।",
    hinglish: "Main tay nahi kar paya ki aage kya karna hai. Please phir se try karein.",
  },
  step_limit: {
    en: "I reached the maximum number of agent steps without completing the request.",
    hi: "मैंने कदमों की तय सीमा पूरी कर ली, पर यह काम पूरा नहीं हुआ।",
    hinglish: "Steps ki limit poori ho gayi, lekin yeh kaam poora nahi hua.",
  },
};

export function fallbackReply(kind: FallbackReply, language: TextLanguage): string {
  return FALLBACK_REPLIES[kind][language];
}
