import { describe, expect, it } from "vitest";
import { buildSsml, escapeXml, escapedBytes, sanitizeText, sentenceUnits, speakableText, splitForSynthesis } from "../../src/tts/ssml.js";

describe("sanitizeText", () => {
  it("replaces the control characters the service refuses, and keeps tab and newline", () => {
    expect(sanitizeText("a\u000bb\u000cc\u0000d\u001fe")).toBe("a b c d e");
    expect(sanitizeText("a\tb\nc")).toBe("a\tb\nc");
    expect(sanitizeText("one\r\ntwo\rthree")).toBe("one\ntwo\nthree");
  });

  it("replaces lone surrogates and the two XML non-characters", () => {
    expect(sanitizeText("a\ud800b")).toBe("a b");
    expect(sanitizeText("a\udfffb")).toBe("a b");
    expect(sanitizeText("a￾b￿c")).toBe("a b c");
  });

  it("keeps astral characters (a surrogate pair) and Hindi as they are", () => {
    expect(sanitizeText("स्वागत 𝒜 ok")).toBe("स्वागत 𝒜 ok");
  });
});

describe("escapeXml", () => {
  it("escapes every character that could change the markup", () => {
    expect(escapeXml(`Tom & Jerry <b> "quoted" 'single'`)).toBe("Tom &amp; Jerry &lt;b&gt; &quot;quoted&quot; &apos;single&apos;");
  });

  it("leaves Hindi alone and counts bytes after escaping", () => {
    expect(escapeXml("आप कैसे हैं?")).toBe("आप कैसे हैं?");
    expect(escapedBytes("a&b")).toBe(7);
    expect(escapedBytes("आ")).toBe(3);
  });
});

describe("speakableText", () => {
  it("passes plain text through unchanged, in English and Hindi", () => {
    expect(speakableText("How are you today?")).toBe("How are you today?");
    expect(speakableText("आप कैसे हैं? मैं ठीक हूँ।")).toBe("आप कैसे हैं? मैं ठीक हूँ।");
    expect(speakableText("It costs 3.5 dollars, 5 * 3 = 15.")).toBe("It costs 3.5 dollars, 5 * 3 = 15.");
  });

  it("keeps the words of Markdown emphasis, headings, bullets, inline code and links", () => {
    expect(speakableText("This is **very** important and *quite* new, and _also_ this.")).toBe("This is very important and quite new, and also this.");
    expect(speakableText("# Plan\n\n- first step\n* second step\n\nRun `npm test` now. See [the docs](https://example.com/docs) please.")).toBe(
      "Plan\n\nfirst step\nsecond step\n\nRun npm test now. See the docs please.",
    );
  });

  it("does not read a fenced code block aloud, nor a bare URL, nor emoji", () => {
    expect(speakableText("Here is the fix:\n```ts\nconst x = 1;\n```\nDone.")).toBe("Here is the fix:\n\nDone.");
    expect(speakableText("Open https://example.com/a?b=c now")).toBe("Open now");
    expect(speakableText("Great job 🎉🙂 team")).toBe("Great job team");
  });

  it("does not mistake snake_case words or maths for emphasis", () => {
    expect(speakableText("use snake_case_names and a * b * c")).toBe("use snake_case_names and a * b * c");
  });

  it("drops horizontal rules and collapses blank space", () => {
    expect(speakableText("one\n\n\n\n---\n\ntwo   words")).toBe("one\n\ntwo words");
  });

  it("leaves nothing for text that is only syntax", () => {
    expect(speakableText("```\ncode only\n```")).toBe("");
    expect(speakableText("🎉🎉")).toBe("");
    expect(speakableText("   ")).toBe("");
  });
});

describe("sentenceUnits", () => {
  it("keeps every character exactly once, whatever the text", () => {
    for (const text of ["Hello. World! How are you?  Fine.", "आप कैसे हैं? मैं ठीक हूँ। धन्यवाद।", "wait... what?!", "no terminator at all", ".leading and trailing.", "line one\nline two\n\nline three", "Pi is 3.14159 and e is 2.71828.", 'He said "stop." Then left.', ""]) {
      expect(sentenceUnits(text).join("")).toBe(text);
    }
  });

  it("ends a unit at a sentence end (with its closing quote and spaces) and at a newline", () => {
    expect(sentenceUnits("Hello. World!")).toEqual(["Hello. ", "World!"]);
    expect(sentenceUnits('He said "stop." Then left.')).toEqual(['He said "stop." ', "Then left."]);
    expect(sentenceUnits("a\nb")).toEqual(["a\n", "b"]);
    expect(sentenceUnits("आप कैसे हैं? ठीक।")).toEqual(["आप कैसे हैं? ", "ठीक।"]);
  });

  it("does not end a sentence at a decimal point", () => {
    expect(sentenceUnits("It is 3.14 now. Done.")).toEqual(["It is 3.14 now. ", "Done."]);
  });
});

describe("splitForSynthesis", () => {
  it("returns short text as one part, and nothing for nothing", () => {
    expect(splitForSynthesis("Hello there.", 3000)).toEqual(["Hello there."]);
    expect(splitForSynthesis("   ", 3000)).toEqual([]);
  });

  it("splits at sentence ends, in order, with every part within the limit once escaped", () => {
    const sentence = "This is one sentence of a reasonable length & it has an ampersand. ";
    const text = sentence.repeat(60).trim();
    const parts = splitForSynthesis(text, 400);
    expect(parts.length).toBeGreaterThan(5);
    for (const part of parts) {
      expect(escapedBytes(part)).toBeLessThanOrEqual(400);
      expect(part.endsWith(".")).toBe(true); // a part ends where a sentence does
    }
    expect(parts.join(" ")).toBe(text);
  });

  it("measures Hindi in bytes: three bytes a letter", () => {
    const text = "यह एक वाक्य है जो काफ़ी लंबा है। ".repeat(80).trim();
    const parts = splitForSynthesis(text, 500);
    expect(parts.length).toBeGreaterThan(5);
    for (const part of parts) expect(escapedBytes(part)).toBeLessThanOrEqual(500);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });

  it("cuts an over-long sentence at spaces, and a run with no spaces between characters, never losing any", () => {
    const longSentence = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const spaced = splitForSynthesis(longSentence, 300);
    for (const part of spaced) expect(escapedBytes(part)).toBeLessThanOrEqual(300);
    expect(spaced.join(" ")).toBe(longSentence);

    const unbroken = "आ".repeat(900) + "&".repeat(100);
    const cut = splitForSynthesis(unbroken, 300);
    for (const part of cut) expect(escapedBytes(part)).toBeLessThanOrEqual(300);
    expect(cut.join("")).toBe(unbroken);
  });

  it("never splits inside an escaped entity, because it splits before escaping", () => {
    const text = "&".repeat(500);
    for (const part of splitForSynthesis(text, 100)) {
      expect(escapedBytes(part)).toBeLessThanOrEqual(100);
      expect(/^&+$/.test(part)).toBe(true);
    }
  });
});

describe("buildSsml", () => {
  it("wraps escaped text in the voice and the neutral prosody the service expects", () => {
    expect(buildSsml("hi-IN-SwaraNeural", "hi-IN", escapeXml("नमस्ते & स्वागत"))).toBe(
      "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='hi-IN'>" +
        "<voice name='hi-IN-SwaraNeural'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>नमस्ते &amp; स्वागत</prosody></voice></speak>",
    );
  });

  it("keeps hostile text inside the prosody element: it cannot close it, add a voice, or add markup", () => {
    const hostile = `</prosody></voice><voice name='en-US-GuyNeural'><prosody rate='+400%'>shout</prosody></voice><speak>`;
    const ssml = buildSsml("en-US-JennyNeural", "en-US", escapeXml(hostile));
    expect(ssml.match(/<voice /g)).toHaveLength(1);
    expect(ssml.match(/<prosody /g)).toHaveLength(1);
    expect(ssml.match(/<\/prosody>/g)).toHaveLength(1);
    expect(ssml.match(/<speak /g)).toHaveLength(1);
    expect(ssml).not.toContain("<voice name='en-US-GuyNeural'");
    expect(ssml).toContain("&lt;/prosody&gt;");
  });

  it("refuses a voice name or locale that is not one, instead of interpolating it", () => {
    expect(() => buildSsml("x'/><voice name='y", "en-US", "hi")).toThrow();
    expect(() => buildSsml("en-US-JennyNeural", "en-US'", "hi")).toThrow();
    expect(() => buildSsml("Kore", "en-US", "hi")).toThrow();
  });
});
