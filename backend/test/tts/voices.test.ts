import { describe, expect, it } from "vitest";
import { DEFAULT_ENGLISH_VOICE, DEFAULT_HINDI_VOICE, detectSpeechLanguage, isVoiceName, resolveVoice, voiceLocale, type VoiceSettings } from "../../src/tts/voices.js";

const defaults: VoiceSettings = { hindi: DEFAULT_HINDI_VOICE, english: DEFAULT_ENGLISH_VOICE, hinglish: DEFAULT_HINDI_VOICE };

describe("the default voices", () => {
  it("are the ones ZARVIS was asked to speak with", () => {
    expect(DEFAULT_HINDI_VOICE).toBe("hi-IN-SwaraNeural");
    expect(DEFAULT_ENGLISH_VOICE).toBe("en-US-JennyNeural");
  });
});

describe("detectSpeechLanguage", () => {
  it("reads Devanagari as Hindi, including Hindi with English words in it", () => {
    expect(detectSpeechLanguage("आप कैसे हैं?")).toBe("hi");
    expect(detectSpeechLanguage("नमस्ते, मैं ज़ार्विस हूँ।")).toBe("hi");
    expect(detectSpeechLanguage("आज की meeting दो बजे है")).toBe("hi");
    // One Devanagari word is enough: this is what the web client always did.
    expect(detectSpeechLanguage("The word नमस्ते means hello")).toBe("hi");
  });

  it("reads plain English as English", () => {
    expect(detectSpeechLanguage("How are you?")).toBe("en");
    expect(detectSpeechLanguage("The main reason is that I will do it today, so please wait.")).toBe("en");
    expect(detectSpeechLanguage("Open the router settings and check the model.")).toBe("en");
  });

  it("reads Hindi typed in Latin letters as Hinglish", () => {
    expect(detectSpeechLanguage("Hello sir, aaj kya karna hai?")).toBe("hinglish");
    expect(detectSpeechLanguage("Open router kaam nahi kar raha hai")).toBe("hinglish");
    expect(detectSpeechLanguage("Ok thik hai")).toBe("hinglish");
  });

  it("calls a very short Hindi phrase Hinglish, but not a long English text with a stray Hindi word", () => {
    expect(detectSpeechLanguage("haan")).toBe("hinglish");
    expect(detectSpeechLanguage("kal")).toBe("hinglish");
    const long = "The quarterly report covers revenue, costs, hiring plans and the product roadmap for the next two quarters, and the team will review the numbers on kal before the board meeting";
    expect(detectSpeechLanguage(long)).toBe("en");
  });

  it("has no opinion about text with no letters at all, and says English", () => {
    expect(detectSpeechLanguage("")).toBe("en");
    expect(detectSpeechLanguage("1234 ... !!!")).toBe("en");
  });
});

describe("resolveVoice", () => {
  it("picks the Hindi voice for Hindi, the English voice for English, and the Hinglish voice for Hinglish", () => {
    expect(resolveVoice("आप कैसे हैं?", undefined, defaults)).toMatchObject({ voice: "hi-IN-SwaraNeural", locale: "hi-IN", language: "hi", source: "auto" });
    expect(resolveVoice("How are you?", undefined, defaults)).toMatchObject({ voice: "en-US-JennyNeural", locale: "en-US", language: "en", source: "auto" });
    expect(resolveVoice("Hello sir, aaj kya karna hai?", undefined, defaults)).toMatchObject({ voice: "hi-IN-SwaraNeural", language: "hinglish" });
  });

  it("uses the configured Hinglish voice, which is how the Hinglish strategy is chosen", () => {
    const settings = { ...defaults, hinglish: "en-IN-NeerjaNeural" };
    expect(resolveVoice("Hello sir, aaj kya karna hai?", undefined, settings)).toMatchObject({ voice: "en-IN-NeerjaNeural", locale: "en-IN", language: "hinglish" });
    // The Hindi and English voices are untouched.
    expect(resolveVoice("आप कैसे हैं?", undefined, settings).voice).toBe("hi-IN-SwaraNeural");
    expect(resolveVoice("How are you?", undefined, settings).voice).toBe("en-US-JennyNeural");
  });

  it("lets a caller name an allowed voice, whatever the language of the text", () => {
    expect(resolveVoice("How are you?", "hi-IN-MadhurNeural", defaults)).toMatchObject({ voice: "hi-IN-MadhurNeural", locale: "hi-IN", source: "explicit" });
    expect(resolveVoice("आप कैसे हैं?", "en-US-GuyNeural", defaults)).toMatchObject({ voice: "en-US-GuyNeural", source: "explicit" });
  });

  it("allows the configured voices even when they are not in the built-in list", () => {
    const settings = { hindi: "hi-IN-KavyaNeural", english: "en-GB-SoniaNeural", hinglish: "hi-IN-KavyaNeural" };
    expect(resolveVoice("x", "en-GB-SoniaNeural", settings)).toMatchObject({ voice: "en-GB-SoniaNeural", source: "explicit" });
  });

  it("ignores a voice that is not allowed, however well formed, and chooses from the text", () => {
    expect(resolveVoice("How are you?", "en-US-SomeoneElseNeural", defaults)).toMatchObject({ voice: "en-US-JennyNeural", source: "auto" });
    expect(resolveVoice("How are you?", "fr-FR-DeniseNeural", defaults).source).toBe("auto");
  });

  it("ignores anything that could change the markup instead of naming a voice", () => {
    for (const hostile of ["en-US-JennyNeural'/><voice name='x", "en-US-JennyNeural\n", "<voice>", "", "  ", 42, null, {}, ["en-US-JennyNeural"]]) {
      expect(resolveVoice("How are you?", hostile, defaults)).toMatchObject({ voice: "en-US-JennyNeural", source: "auto" });
    }
  });

  it("keeps the old Gemini voice names working as a choice of style: the usual voice, or a male one", () => {
    expect(resolveVoice("How are you?", "Kore", defaults)).toMatchObject({ voice: "en-US-JennyNeural", source: "style" });
    expect(resolveVoice("How are you?", "Aoede", defaults)).toMatchObject({ voice: "en-US-JennyNeural", source: "style" });
    for (const name of ["Puck", "Charon", "Fenrir"]) {
      expect(resolveVoice("How are you?", name, defaults)).toMatchObject({ voice: "en-US-GuyNeural", locale: "en-US", source: "style" });
      expect(resolveVoice("आप कैसे हैं?", name, defaults)).toMatchObject({ voice: "hi-IN-MadhurNeural", locale: "hi-IN", source: "style" });
    }
  });

  it("keeps a male style in the language of the configured Hinglish voice", () => {
    const settings = { ...defaults, hinglish: "en-IN-NeerjaNeural" };
    expect(resolveVoice("Hello sir, aaj kya karna hai?", "Puck", settings).voice).toBe("en-IN-PrabhatNeural");
  });

  it("does not take inherited object properties for voice names", () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(resolveVoice("How are you?", name, defaults).source).toBe("auto");
    }
  });
});

describe("voice names", () => {
  it("recognises Edge short names and nothing else", () => {
    expect(isVoiceName("hi-IN-SwaraNeural")).toBe(true);
    expect(isVoiceName("en-US-AvaMultilingualNeural")).toBe(true);
    expect(isVoiceName("fil-PH-AngeloNeural")).toBe(true);
    for (const bad of ["Kore", "hi-IN-Swara", "hi-in-SwaraNeural", "hi-IN-Swara Neural", "hi-IN-SwaraNeural'", `en-US-${"A".repeat(80)}Neural`, undefined, 7]) {
      expect(isVoiceName(bad)).toBe(false);
    }
  });

  it("reads the locale off the voice name", () => {
    expect(voiceLocale("hi-IN-SwaraNeural")).toBe("hi-IN");
    expect(voiceLocale("fil-PH-AngeloNeural")).toBe("fil-PH");
  });
});
