import { describe, expect, it } from "vitest";
import { decodeUploadFilename, stripNul, stripNulDeep } from "../../src/security/sanitizeText.js";

describe("stripNul / stripNulDeep", () => {
  it("removes NUL from strings, nested values and keys, and leaves everything else alone", () => {
    expect(stripNul("a\u0000b\u0000")).toBe("ab");
    expect(stripNul("plain")).toBe("plain");
    const input = { "k\u0000ey": ["x\u0000", { deep: "y\u0000z" }], n: 5, ok: true, nothing: null };
    expect(stripNulDeep(input)).toEqual({ key: ["x", { deep: "yz" }], n: 5, ok: true, nothing: null });
  });

  it("does not recurse without bound", () => {
    let nested: unknown = "end\u0000";
    for (let i = 0; i < 200; i += 1) nested = { next: nested };
    expect(() => stripNulDeep(nested)).not.toThrow();
  });

  it("keeps Devanagari, emoji and other non-ASCII text exactly", () => {
    const text = "नमस्ते 🙂 résumé";
    expect(stripNulDeep({ text })).toEqual({ text });
  });
});

describe("decodeUploadFilename", () => {
  it("repairs a UTF-8 name that was decoded as latin1", () => {
    const asLatin1 = (name: string) => Buffer.from(name, "utf8").toString("latin1");
    expect(decodeUploadFilename(asLatin1("रिपोर्ट.docx"))).toBe("रिपोर्ट.docx");
    expect(decodeUploadFilename(asLatin1("résumé.pdf"))).toBe("résumé.pdf");
  });

  it("leaves ASCII names, already-decoded names and genuine latin1 text alone", () => {
    expect(decodeUploadFilename("plain.docx")).toBe("plain.docx");
    expect(decodeUploadFilename("रिपोर्ट.docx")).toBe("रिपोर्ट.docx"); // already Unicode: has characters above U+00FF
    expect(decodeUploadFilename("café")).toBe("café"); // a lone latin1 byte is not valid UTF-8
  });

  it("removes NUL", () => {
    expect(decodeUploadFilename("a\u0000b.txt")).toBe("ab.txt");
  });
});
