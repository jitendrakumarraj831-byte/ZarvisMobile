import { createHash } from "node:crypto";

/**
 * Deterministic JSON serialization (object keys sorted recursively) so two structurally
 * identical inputs always produce the same string — used to bind a confirmation to one exact
 * tool input and to detect duplicate tool requests inside one agent run.
 */
export function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + stableJson(record[key])).join(",") + "}";
}

export function hashInput(input: Record<string, unknown>): string {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}
