import type { NextFunction, Request, Response } from "express";

/**
 * Text that reaches the store must be storable. PostgreSQL text columns refuse the NUL character (U+0000): a chat message,
 * note, task, project name or file text containing one ended in HTTP 500 `internal_error` (and, for a chat turn, after
 * the model had already been called). NUL has no meaning in text a person typed or pasted (it appears when text is copied
 * out of a PDF or a binary file), so it is removed at the door, once, for every route.
 */
const NUL = /\u0000/g;
const MAX_DEPTH = 32;

export function stripNul(text: string): string {
  return text.includes("\u0000") ? text.replace(NUL, "") : text;
}

/** A copy of `value` with NUL removed from every string and every object key. Depth-limited; anything else passes through. */
export function stripNulDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return stripNul(value);
  if (depth >= MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => stripNulDeep(item, depth + 1));
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[stripNul(key)] = stripNulDeep(item, depth + 1);
  return out;
}

/** Express middleware: cleans `req.body` and `req.query` (the raw body kept for webhook signatures is left untouched). */
export function stripNulFromRequest(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === "object") req.body = stripNulDeep(req.body);
  const query = req.query;
  if (query && Object.keys(query).length > 0) {
    const cleaned = stripNulDeep({ ...query }) as Record<string, unknown>;
    for (const key of Object.keys(query)) delete (query as Record<string, unknown>)[key];
    Object.assign(query, cleaned);
  }
  next();
}

/**
 * multipart file names arrive decoded as latin1 (the parser's default), so a UTF-8 name such as "रिपोर्ट.docx" or "résumé.pdf"
 * is stored as mojibake. When every character is a latin1 byte and those bytes are valid UTF-8, the name was UTF-8: decode it.
 * A name that is genuinely latin1 text (it does not form valid UTF-8) is returned as it came. NUL is removed either way.
 */
export function decodeUploadFilename(name: string): string {
  const clean = stripNul(name);
  if (!/[\u0080-ÿ]/.test(clean) || /[^\u0000-ÿ]/.test(clean)) return clean;
  const decoded = Buffer.from(clean, "latin1").toString("utf8");
  return decoded.includes("�") ? clean : decoded;
}
