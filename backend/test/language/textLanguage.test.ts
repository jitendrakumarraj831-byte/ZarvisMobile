import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/agents/orchestrator.js";
import { detectReplyLanguage, detectTextLanguage } from "../../src/language/textLanguage.js";
import { detectSpeechLanguage } from "../../src/tts/voices.js";

/**
 * Phase 1 reliability: the language ZARVIS replies in follows the user's CURRENT message, and the voice that speaks a
 * reply is chosen by the same detector. These phrases are the ones people actually type or say to an assistant.
 */
const ENGLISH = [
  "What is the capital of France?",
  "Do you know a good book?",
  "Tell me about the moon",
  "How do I reset my password?",
  "Summarize the document",
  "Write a cover letter for the job",
  "what is the weather today",
  "can you help me with my homework",
  "set an alarm for 6am",
  "Call Lena",
  "open YouTube",
  "ok thanks",
  "What does the word kya mean in Hindi?",
];

const HINGLISH = [
  "mummy ko call karo",
  "kal subah 6 baje alarm laga do",
  "mujhe 5 baje yaad dilana",
  "WhatsApp kholo",
  "aaj ka mausam kaisa hai",
  "kya haal hai",
  "mera naam yaad rakhna",
  "notifications padh ke sunao",
  "screen pe kya likha hai",
  "bhai ek email likh do boss ko",
  "kal Forbesganj ka weather kaisa rahega",
  "please mujhe ek poem likh do",
  "main kal office jaunga",
  "Rahul ko message bhejo ki main late hoon",
  "aapko kisne banaya",
  "tumhara boss kaun hai?",
  "theek hai",
  "haan ji",
];

const HINDI = ["मम्मी को कॉल करो", "आज मौसम कैसा है", "आज की meeting दो बजे है", "मेरा नाम याद रखना"];

const replyInstruction = (utterance: string, locale = "en") =>
  buildSystemPrompt({ accountId: "a", utterance, locale } as never, 0, false).match(/Respond in (Hindi\/Hinglish|English)/)?.[1];

describe("the reply language follows the user's current message", () => {
  it.each(ENGLISH)("English stays English, even with words like 'the' and 'do' in it: %s", (utterance) => {
    expect(detectReplyLanguage(utterance, "en")).toBe("en");
    // A Hindi app language does not turn an English message into a Hindi reply.
    expect(detectReplyLanguage(utterance, "hi")).toBe("en");
    expect(replyInstruction(utterance)).toBe("English");
  });

  it.each(HINGLISH)("Hindi typed in Latin letters is answered in Hindi/Hinglish, whatever the app language: %s", (utterance) => {
    expect(detectReplyLanguage(utterance, "en")).toBe("hi");
    expect(replyInstruction(utterance, "en")).toBe("Hindi/Hinglish");
  });

  it.each(HINDI)("Devanagari is answered in Hindi: %s", (utterance) => {
    expect(detectReplyLanguage(utterance, "en")).toBe("hi");
    expect(replyInstruction(utterance, "en")).toBe("Hindi/Hinglish");
  });

  it("uses the app language only to break a tie, when the message has no language of its own", () => {
    for (const utterance of ["Forbesganj", "1234", "👍", "Jitendra Kumar"]) {
      expect(detectReplyLanguage(utterance, "hi")).toBe("hi");
      expect(detectReplyLanguage(utterance, "en")).toBe("en");
      expect(detectReplyLanguage(utterance)).toBe("en");
    }
  });
});

describe("one detector for the reply and the voice", () => {
  it("the voice detector is the reply detector", () => {
    expect(detectSpeechLanguage).toBe(detectTextLanguage);
  });

  it.each([...ENGLISH, ...HINGLISH, ...HINDI])("a reply in the language of the message is spoken in that language: %s", (utterance) => {
    // If ZARVIS answers in Hindi/Hinglish, the same words are spoken by the Hindi or Hinglish voice, and English by the English voice.
    const spoken = detectSpeechLanguage(utterance);
    expect(spoken === "en" ? "en" : "hi").toBe(detectReplyLanguage(utterance, "en"));
  });

  it("keeps the Hinglish voice for Latin Hindi and the Hindi voice for Devanagari", () => {
    expect(detectTextLanguage("Rahul ko message bhejo ki main late hoon")).toBe("hinglish");
    expect(detectTextLanguage("मम्मी को कॉल करो")).toBe("hi");
    expect(detectTextLanguage("Open the router settings and check the model.")).toBe("en");
  });
});
