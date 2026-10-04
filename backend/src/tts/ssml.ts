/**
 * Turning a reply into text the speech service can say, and into the SSML it is sent in.
 *
 * Replies reach the voice as the model wrote them: with Markdown, links and emoji. A voice would
 * read some of that out ("asterisk asterisk"), so `speakableText` removes the syntax and keeps the
 * words. Everything that goes into the SSML is escaped: the text is untrusted (it is the model's
 * reply, or a client's request), and an unescaped `</prosody><voice name=...>` inside it would
 * let it change the voice or the markup.
 */
import { isVoiceName } from "./voices.js";

/**
 * Control characters the service does not support (the vertical tab from a PDF is the usual one),
 * lone surrogates and the two non-characters, which are not valid XML, become spaces. Tab and
 * newline stay. Line endings are normalised to `\n`.
 */
export function sanitizeText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const unsupported =
      code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff;
    out += unsupported ? " " : ch;
  }
  return out.replace(/\r\n?/g, "\n");
}

/**
 * The words of a reply without its Markdown: fenced code is skipped (nobody wants it read aloud),
 * inline code, links and emphasis keep their words, headings and bullets lose their marks, bare
 * URLs and emoji are dropped. Plain text passes through unchanged.
 */
export function speakableText(text: string): string {
  let t = sanitizeText(text);
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/`([^`\n]+)`/g, "$1");
  t = t.replace(/!?\[([^\]\n]*)\]\([^)\s]*\)/g, "$1");
  t = t.replace(/https?:\/\/\S+/gi, " ");
  t = t.replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2");
  t = t.replace(/(^|[\s(])\*(?=\S)([^*\n]+?)(?<=\S)\*(?=$|[\s).,!?;:])/g, "$1$2");
  t = t.replace(/(^|[\s(])_(?=\S)([^_\n]+?)(?<=\S)_(?=$|[\s).,!?;:])/g, "$1$2");
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  t = t.replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, " ");
  t = t.replace(/^[ \t]*[-*•][ \t]+/gm, "");
  t = t.replace(/[\p{Extended_Pictographic}️‍]/gu, " ");
  return t.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch] as string);
}

export function escapedBytes(text: string): number {
  return Buffer.byteLength(escapeXml(text), "utf8");
}

const TERMINATORS = new Set([".", "!", "?", "।", "…"]);
const CLOSERS = new Set(['"', "'", ")", "]", "”", "’"]);

/** Sentences, each with its terminator and the spaces after it; a newline ends a unit too. `units(t).join("") === t`. */
export function sentenceUnits(text: string): string[] {
  const units: string[] = [];
  let current = "";
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    current += ch;
    if (ch === "\n") {
      while (chars[i + 1] === "\n") current += chars[++i]!;
      units.push(current);
      current = "";
    } else if (TERMINATORS.has(ch)) {
      // A decimal point (3.5) is not the end of a sentence.
      if (ch === "." && /\d/.test(chars[i - 1] ?? "") && /\d/.test(chars[i + 1] ?? "")) continue;
      while (TERMINATORS.has(chars[i + 1] ?? "") || CLOSERS.has(chars[i + 1] ?? "")) current += chars[++i]!;
      while (chars[i + 1] === " " || chars[i + 1] === "\t") current += chars[++i]!;
      units.push(current);
      current = "";
    }
  }
  if (current) units.push(current);
  return units;
}

/** Cuts one over-long unit at spaces, and, for a run with no space at all, between characters. */
function splitLongUnit(unit: string, maxEscapedBytes: number): string[] {
  const pieces: string[] = [];
  let current = "";
  const flush = () => {
    if (current) pieces.push(current);
    current = "";
  };
  for (const token of unit.split(/(\s+)/).filter(Boolean)) {
    if (escapedBytes(current + token) <= maxEscapedBytes) {
      current += token;
      continue;
    }
    flush();
    if (escapedBytes(token) <= maxEscapedBytes) {
      current = token;
      continue;
    }
    for (const ch of Array.from(token)) {
      if (escapedBytes(current + ch) > maxEscapedBytes) flush();
      current += ch;
    }
  }
  flush();
  return pieces;
}

/**
 * Splits text into parts that each fit the service's per-request limit once escaped (the service
 * refuses an SSML message of more than about 4 KB; Hindi is three bytes a letter). Parts end at
 * sentence ends where they can, then at spaces, and only as a last resort inside a word; they are
 * spoken one after the other, in order.
 */
export function splitForSynthesis(text: string, maxEscapedBytes: number): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (escapedBytes(clean) <= maxEscapedBytes) return [clean];

  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    const chunk = current.trim();
    if (chunk) chunks.push(chunk);
    current = "";
  };
  for (const unit of sentenceUnits(clean)) {
    if (escapedBytes(current + unit) <= maxEscapedBytes) {
      current += unit;
      continue;
    }
    flush();
    if (escapedBytes(unit) <= maxEscapedBytes) {
      current = unit;
      continue;
    }
    for (const piece of splitLongUnit(unit, maxEscapedBytes)) {
      if (escapedBytes(current + piece) > maxEscapedBytes) flush();
      current += piece;
    }
  }
  flush();
  return chunks;
}

/** `escapedText` must already be escaped (see `escapeXml`). `voice` and `locale` are checked, not trusted. */
export function buildSsml(voice: string, locale: string, escapedText: string): string {
  if (!isVoiceName(voice) || !/^[a-z]{2,3}-[A-Z]{2}$/.test(locale)) throw new Error("Not a valid voice name or locale");
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${locale}'>` +
    `<voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapedText}</prosody></voice></speak>`
  );
}
