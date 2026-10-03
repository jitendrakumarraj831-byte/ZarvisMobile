import { CAPABILITIES, type Capability } from "../ai/capabilities.js";
import {
  geminiEntry,
  openRouterEntry,
  parseCatalogJson,
  type CatalogProvider,
  type ModelEntry,
} from "../ai/modelCatalog.js";
import { DEFAULT_OPENROUTER_BASE_URL } from "../ai/openRouterProvider.js";
import { AIConfigError } from "./aiConfigError.js";

/**
 * Validates and resolves every AI setting once, when the server is built, so a typo stops the
 * server with a clear message instead of surfacing later as an unexplained AI failure.
 *
 * Absent is not invalid: with no OpenRouter key the fallback is simply off, with no Gemini key the
 * gateway answers through OpenRouter, with neither the AI reports itself unavailable. Only a
 * value that is *present and wrong* is an error.
 *
 * Every message names variables and problems, never a configured value (a mistyped variable can
 * easily hold a secret).
 */
export interface AIConfigInput {
  geminiModel: string;
  aiPrimaryProvider?: string;
  aiFallbackProvider?: string;
  openRouterBaseUrl?: string;
  openRouterModel?: string;
  openRouterModelCapabilities?: string;
  openRouterModelContextTokens?: string;
  openRouterTimeoutMs?: string;
  aiModelCatalogJson?: string;
  aiQuotaCooldownMs?: string;
}

export interface ResolvedAIConfig {
  /** What the operator prefers; whether it is usable depends on credentials, per request. */
  preferredPrimary: CatalogProvider;
  /** `null` when the fallback is disabled (`AI_FALLBACK_PROVIDER=none`). */
  preferredFallback: CatalogProvider | null;
  catalog: ModelEntry[];
  openRouter: { baseUrl: string; timeoutMs: number };
  /** How long a provider that reported an exhausted quota is skipped (0 = never skip). */
  quotaCooldownMs: number;
  /** Non-fatal findings, logged once at startup. */
  warnings: string[];
}

export const DEFAULT_OPENROUTER_MODEL = "openrouter/free";
const DEFAULT_OPENROUTER_TIMEOUT_MS = 60_000;
const DEFAULT_QUOTA_COOLDOWN_MS = 5 * 60_000;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
/** Capabilities an operator may declare for the default OpenRouter model. */
const DECLARABLE: readonly Capability[] = ["tools", "vision", "structuredOutput", "coding", "reasoning"];

function blank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function parseProvider(name: string, raw: string | undefined, fallbackValue: CatalogProvider | null, allowNone: boolean, problems: string[]): CatalogProvider | null {
  if (blank(raw)) return fallbackValue;
  const value = raw!.trim().toLowerCase();
  if (value === "gemini" || value === "google") return "google";
  if (value === "openrouter") return "openrouter";
  if (allowNone && (value === "none" || value === "off" || value === "disabled")) return null;
  problems.push(`${name} must be ${allowNone ? '"gemini", "openrouter" or "none"' : '"gemini" or "openrouter"'}`);
  return fallbackValue;
}

function parseInteger(name: string, raw: string | undefined, fallbackValue: number, min: number, max: number, problems: string[]): number {
  if (blank(raw)) return fallbackValue;
  const text = raw!.trim();
  const value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < min || value > max) {
    problems.push(`${name} must be a whole number from ${min} to ${max}`);
    return fallbackValue;
  }
  return value;
}

function parseBaseUrl(raw: string | undefined, problems: string[], warnings: string[]): string {
  if (blank(raw)) return DEFAULT_OPENROUTER_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw!.trim());
  } catch {
    problems.push("OPENROUTER_BASE_URL is not a valid URL");
    return DEFAULT_OPENROUTER_BASE_URL;
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    // The API key travels in the Authorization header of every request to this address.
    problems.push("OPENROUTER_BASE_URL must use https (http is allowed only for localhost)");
  }
  if (url.username || url.password) problems.push("OPENROUTER_BASE_URL must not contain credentials");
  if (url.search || url.hash) problems.push("OPENROUTER_BASE_URL must not contain a query string or fragment");
  if (url.hostname !== "openrouter.ai" && !loopback) {
    warnings.push("OPENROUTER_BASE_URL points at a host other than openrouter.ai: the OpenRouter API key is sent to that host");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

function parseCapabilityList(raw: string | undefined, problems: string[]): Capability[] {
  if (blank(raw)) return [];
  const out: Capability[] = [];
  for (const token of raw!.split(/[\s,]+/).filter(Boolean)) {
    const match = CAPABILITIES.find((capability) => capability.toLowerCase() === token.toLowerCase());
    if (match === "text" || match === "streaming") continue; // always on for the default entry
    if (!match || !DECLARABLE.includes(match)) {
      problems.push(`OPENROUTER_MODEL_CAPABILITIES lists an unknown capability; allowed: ${DECLARABLE.join(", ")}`);
      return out;
    }
    if (!out.includes(match)) out.push(match);
  }
  return out;
}

export function resolveAIConfig(input: AIConfigInput): ResolvedAIConfig {
  const problems: string[] = [];
  const warnings: string[] = [];

  const preferredPrimary = parseProvider("AI_PRIMARY_PROVIDER", input.aiPrimaryProvider, "google", false, problems) ?? "google";
  const defaultFallback: CatalogProvider = preferredPrimary === "google" ? "openrouter" : "google";
  const preferredFallback = parseProvider("AI_FALLBACK_PROVIDER", input.aiFallbackProvider, defaultFallback, true, problems);
  if (preferredFallback !== null && preferredFallback === preferredPrimary) {
    problems.push("AI_FALLBACK_PROVIDER must differ from AI_PRIMARY_PROVIDER (use \"none\" to disable the fallback)");
  }

  const baseUrl = parseBaseUrl(input.openRouterBaseUrl, problems, warnings);
  const timeoutMs = parseInteger("OPENROUTER_TIMEOUT_MS", input.openRouterTimeoutMs, DEFAULT_OPENROUTER_TIMEOUT_MS, 1_000, 300_000, problems);
  const contextTokens = parseInteger("OPENROUTER_MODEL_CONTEXT_TOKENS", input.openRouterModelContextTokens, 32_768, 1_000, 10_000_000, problems);
  const quotaCooldownMs = parseInteger("AI_QUOTA_COOLDOWN_MS", input.aiQuotaCooldownMs, DEFAULT_QUOTA_COOLDOWN_MS, 0, 86_400_000, problems);

  const openRouterModel = blank(input.openRouterModel) ? DEFAULT_OPENROUTER_MODEL : input.openRouterModel!.trim();
  if (!MODEL_ID.test(openRouterModel)) problems.push("OPENROUTER_MODEL is not a valid model id");
  const extraCapabilities = parseCapabilityList(input.openRouterModelCapabilities, problems);

  if (!MODEL_ID.test(input.geminiModel)) problems.push("GEMINI_MODEL is not a valid model id");

  let fromJson: ModelEntry[] = [];
  if (!blank(input.aiModelCatalogJson)) {
    try {
      fromJson = parseCatalogJson(input.aiModelCatalogJson!);
    } catch (error) {
      if (error instanceof AIConfigError) problems.push(...error.problems);
      else throw error;
    }
  }

  if (problems.length > 0) throw new AIConfigError(problems);

  const defaults: ModelEntry[] = [
    geminiEntry(input.geminiModel),
    openRouterEntry({ model: openRouterModel, extraCapabilities, contextTokens }),
  ];
  // A provider the JSON mentions is described entirely by the JSON; the simple variables only
  // describe providers the JSON leaves out.
  const listed = new Set(fromJson.map((entry) => entry.provider));
  if (listed.has("openrouter") && (!blank(input.openRouterModel) || !blank(input.openRouterModelCapabilities))) {
    warnings.push("OPENROUTER_MODEL / OPENROUTER_MODEL_CAPABILITIES are ignored because AI_MODEL_CATALOG_JSON lists OpenRouter models");
  }
  const catalog = [...defaults.filter((entry) => !listed.has(entry.provider)), ...fromJson];

  return { preferredPrimary, preferredFallback, catalog, openRouter: { baseUrl, timeoutMs }, quotaCooldownMs, warnings };
}
