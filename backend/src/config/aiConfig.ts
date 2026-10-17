import { CAPABILITIES, type Capability } from "../ai/capabilities.js";
import {
  CATALOG_PROVIDERS,
  DEFAULT_GROQ_CONTEXT_TOKENS,
  geminiEntry,
  groqEntry,
  MODEL_ID_PATTERN,
  openAIEntry,
  openRouterEntry,
  parseCatalogJson,
  type CatalogProvider,
  type ModelEntry,
} from "../ai/modelCatalog.js";
import { FALLBACK_MODEL as GEMINI_FALLBACK_MODEL } from "../ai/geminiProvider.js";
import { DEFAULT_OPENROUTER_BASE_URL } from "../ai/openRouterHttp.js";
import { DEFAULT_GROQ_BASE_URL, DEFAULT_OPENAI_BASE_URL, MAX_MODELS_PER_REQUEST } from "../ai/openRouterProvider.js";
import { AIConfigError } from "./aiConfigError.js";

/**
 * Validates and resolves every AI setting once, when the server is built, so a typo stops the
 * server with a clear message instead of surfacing later as an unexplained AI failure.
 *
 * Absent is not invalid: a provider without credentials is skipped (with no OpenRouter key the
 * OpenRouter step of the fallback chain is simply off), with no Gemini key the next provider in the
 * chain answers first, with none the AI reports itself unavailable. Only a
 * value that is *present and wrong* is an error.
 *
 * Every message names variables and problems, never a configured value (a mistyped variable can
 * easily hold a secret).
 */
export interface AIConfigInput {
  geminiModel: string;
  geminiFallbackModels?: string;
  aiPrimaryProvider?: string;
  aiFallbackProvider?: string;
  openRouterBaseUrl?: string;
  openRouterModel?: string;
  openRouterModelCapabilities?: string;
  openRouterModelContextTokens?: string;
  openRouterTimeoutMs?: string;
  openRouterDiscovery?: string;
  openRouterFallbackModels?: string;
  openRouterAllowPaid?: string;
  openRouterMaxPricePrompt?: string;
  openRouterMaxPriceCompletion?: string;
  openRouterMaxOutputTokens?: string;
  openRouterDataCollection?: string;
  openAiBaseUrl?: string;
  openAiModel?: string;
  openAiModelCapabilities?: string;
  openAiModelContextTokens?: string;
  openAiTimeoutMs?: string;
  openAiMaxOutputTokens?: string;
  groqBaseUrl?: string;
  groqModel?: string;
  groqModelCapabilities?: string;
  groqModelContextTokens?: string;
  groqTimeoutMs?: string;
  groqMaxOutputTokens?: string;
  aiModelCatalogJson?: string;
  aiQuotaCooldownMs?: string;
}

export interface ResolvedAIConfig {
  /** What the operator prefers; whether it is usable depends on credentials, per request. */
  preferredPrimary: CatalogProvider;
  /** The first fallback; `null` when fallback is disabled (`AI_FALLBACK_PROVIDER=none`). */
  preferredFallback: CatalogProvider | null;
  /** Every fallback, in the order they are tried after the primary (empty when disabled). */
  preferredFallbacks: CatalogProvider[];
  /** Gemini models tried after `GEMINI_MODEL` inside one request (`GEMINI_FALLBACK_MODELS`). */
  geminiFallbackModels: string[];
  catalog: ModelEntry[];
  openRouter: {
    baseUrl: string;
    timeoutMs: number;
    /** Read OpenRouter's live model list (default on). */
    discovery: boolean;
    /** Operator-named alternates, in order (at most two: with the main model that is OpenRouter's limit of three per request). */
    fallbackModels: string[];
    allowPaid: boolean;
    /** US dollars per million tokens. */
    maxPricePromptPerM?: number;
    maxPriceCompletionPerM?: number;
    maxOutputTokens?: number;
    dataCollection?: "allow" | "deny";
  };
  /** The OpenAI-compatible endpoint (the `openai` provider). It has a catalog entry only when `OPENAI_MODEL` is set. */
  openAI: {
    baseUrl: string;
    timeoutMs: number;
    model?: string;
    maxOutputTokens?: number;
  };
  /** Groq's OpenAI-compatible endpoint (the `groq` provider). Its model has a default, so it always has a catalog entry. */
  groq: {
    baseUrl: string;
    timeoutMs: number;
    model: string;
    maxOutputTokens?: number;
  };
  /** How long a provider that reported an exhausted quota is skipped (0 = never skip). */
  quotaCooldownMs: number;
  /** Non-fatal findings, logged once at startup. */
  warnings: string[];
}

export const DEFAULT_OPENROUTER_MODEL = "openrouter/free";
/**
 * A Groq production model that calls tools. Groq retired llama-3.3-70b-versatile on its free and developer tiers
 * (16 August 2026) and names this model as its replacement. GROQ_MODEL overrides it.
 */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
const DEFAULT_OPENROUTER_TIMEOUT_MS = 60_000;
const DEFAULT_QUOTA_COOLDOWN_MS = 5 * 60_000;
const MODEL_ID = MODEL_ID_PATTERN;
/** Capabilities an operator may declare for the default OpenRouter model. */
const DECLARABLE: readonly Capability[] = ["tools", "vision", "structuredOutput", "coding", "reasoning"];

function blank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function providerName(value: string): CatalogProvider | undefined {
  if (value === "gemini" || value === "google") return "google";
  if (value === "openrouter") return "openrouter";
  if (value === "openai") return "openai";
  if (value === "groq") return "groq";
  return undefined;
}

/** Unset: the first provider of the default order (Groq). Without a Groq key the next provider in the chain answers first. */
function parsePrimary(raw: string | undefined, problems: string[]): CatalogProvider {
  if (blank(raw)) return CATALOG_PROVIDERS[0];
  const provider = providerName(raw!.trim().toLowerCase());
  if (provider) return provider;
  problems.push('AI_PRIMARY_PROVIDER must be "groq", "gemini", "openrouter" or "openai"');
  return CATALOG_PROVIDERS[0];
}

/**
 * `AI_FALLBACK_PROVIDER`: one provider, or several in the order they are tried ("openrouter,openai"), or `none`.
 * Unset: every other provider, in the default order groq, openrouter, gemini, openai (a provider without
 * credentials is simply skipped, per request).
 */
function parseFallbacks(raw: string | undefined, primary: CatalogProvider, problems: string[]): CatalogProvider[] {
  if (blank(raw)) return CATALOG_PROVIDERS.filter((provider) => provider !== primary);
  const tokens = raw!.split(/[\s,]+/).filter(Boolean).map((token) => token.toLowerCase());
  if (tokens.length === 1 && ["none", "off", "disabled"].includes(tokens[0]!)) return [];
  const out: CatalogProvider[] = [];
  for (const token of tokens) {
    const provider = providerName(token);
    if (!provider) {
      problems.push('AI_FALLBACK_PROVIDER must list "groq", "gemini", "openrouter" and/or "openai" (comma-separated, in order), or be "none"');
      return [];
    }
    if (provider === primary) {
      problems.push('AI_FALLBACK_PROVIDER must not list AI_PRIMARY_PROVIDER (use "none" to disable the fallback)');
      return [];
    }
    if (!out.includes(provider)) out.push(provider);
  }
  return out;
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

function parseBoolean(name: string, raw: string | undefined, fallbackValue: boolean, problems: string[]): boolean {
  if (blank(raw)) return fallbackValue;
  const value = raw!.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(value)) return false;
  problems.push(`${name} must be true or false`);
  return fallbackValue;
}

/** A price in US dollars per million tokens, e.g. `0` (free only) or `0.5`. */
function parsePrice(name: string, raw: string | undefined, problems: string[]): number | undefined {
  if (blank(raw)) return undefined;
  const text = raw!.trim();
  const value = Number(text);
  if (!/^\d+(\.\d+)?$/.test(text) || !Number.isFinite(value) || value > 1_000) {
    problems.push(`${name} must be a number of US dollars per million tokens, from 0 to 1000`);
    return undefined;
  }
  return value;
}

function parseModelList(name: string, raw: string | undefined, problems: string[], max = MAX_MODELS_PER_REQUEST - 1): string[] {
  if (blank(raw)) return [];
  const ids: string[] = [];
  for (const token of raw!.split(/[\s,]+/).filter(Boolean)) {
    if (!MODEL_ID.test(token)) {
      problems.push(`${name} contains a value that is not a valid model id`);
      return [];
    }
    if (!ids.includes(token)) ids.push(token);
  }
  if (ids.length > max) {
    problems.push(
      max === MAX_MODELS_PER_REQUEST - 1
        ? `${name} lists more than ${max} models (OpenRouter accepts ${MAX_MODELS_PER_REQUEST} per request, including the main one)`
        : `${name} lists more than ${max} models`,
    );
    return ids.slice(0, max);
  }
  return ids;
}

/** The default URL and the host it is expected on, per variable. Another host is allowed, with a warning. */
const BASE_URLS = {
  OPENROUTER_BASE_URL: { fallback: DEFAULT_OPENROUTER_BASE_URL, host: "openrouter.ai", key: "OpenRouter" },
  OPENAI_BASE_URL: { fallback: DEFAULT_OPENAI_BASE_URL, host: "api.openai.com", key: "OPENAI" },
  GROQ_BASE_URL: { fallback: DEFAULT_GROQ_BASE_URL, host: "api.groq.com", key: "Groq" },
} as const;

function parseBaseUrl(raw: string | undefined, problems: string[], warnings: string[], name: keyof typeof BASE_URLS = "OPENROUTER_BASE_URL"): string {
  const { fallback, host, key } = BASE_URLS[name];
  if (blank(raw)) return fallback;
  let url: URL;
  try {
    url = new URL(raw!.trim());
  } catch {
    problems.push(`${name} is not a valid URL`);
    return fallback;
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    // The API key travels in the Authorization header of every request to this address.
    problems.push(`${name} must use https (http is allowed only for localhost)`);
  }
  if (url.username || url.password) problems.push(`${name} must not contain credentials`);
  if (url.search || url.hash) problems.push(`${name} must not contain a query string or fragment`);
  // An OpenAI-compatible endpoint is often not OpenAI's own (that is what the variable is for): no warning for it.
  if (name !== "OPENAI_BASE_URL" && url.hostname !== host && !loopback) {
    warnings.push(`${name} points at a host other than ${host}: the ${key} API key is sent to that host`);
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** The validated OpenRouter base URL for callers outside the gateway (web search). Throws an `AIConfigError` like startup does. */
export function resolveOpenRouterBaseUrl(raw: string | undefined): string {
  return resolveBaseUrl(raw, "OPENROUTER_BASE_URL");
}

/** The validated Groq base URL for callers outside the gateway (web search), like {@link resolveOpenRouterBaseUrl}. */
export function resolveGroqBaseUrl(raw: string | undefined): string {
  return resolveBaseUrl(raw, "GROQ_BASE_URL");
}

/** `GEMINI_FALLBACK_MODELS` for callers outside the gateway (web search): validated, and defaulted, as for chat. */
export function resolveGeminiFallbackModels(raw: string | undefined): string[] {
  const problems: string[] = [];
  const models = blank(raw) ? [GEMINI_FALLBACK_MODEL] : parseModelList("GEMINI_FALLBACK_MODELS", raw, problems, 5);
  if (problems.length > 0) throw new AIConfigError(problems);
  return models;
}

function resolveBaseUrl(raw: string | undefined, name: keyof typeof BASE_URLS): string {
  const problems: string[] = [];
  const url = parseBaseUrl(raw, problems, [], name);
  if (problems.length > 0) throw new AIConfigError(problems);
  return url;
}

function parseCapabilityList(raw: string | undefined, problems: string[], name = "OPENROUTER_MODEL_CAPABILITIES"): Capability[] {
  if (blank(raw)) return [];
  const out: Capability[] = [];
  for (const token of raw!.split(/[\s,]+/).filter(Boolean)) {
    // "none" states "text and streaming only" (OPENAI_MODEL_CAPABILITIES otherwise defaults to tools).
    if (token.toLowerCase() === "none") continue;
    const match = CAPABILITIES.find((capability) => capability.toLowerCase() === token.toLowerCase());
    if (match === "text" || match === "streaming") continue; // always on for the default entry
    if (!match || !DECLARABLE.includes(match)) {
      problems.push(`${name} lists an unknown capability; allowed: ${DECLARABLE.join(", ")}, or none`);
      return out;
    }
    if (!out.includes(match)) out.push(match);
  }
  return out;
}

export function resolveAIConfig(input: AIConfigInput): ResolvedAIConfig {
  const problems: string[] = [];
  const warnings: string[] = [];

  const preferredPrimary = parsePrimary(input.aiPrimaryProvider, problems);
  const preferredFallbacks = parseFallbacks(input.aiFallbackProvider, preferredPrimary, problems);
  const geminiFallbackModels = blank(input.geminiFallbackModels) ? [GEMINI_FALLBACK_MODEL] : parseModelList("GEMINI_FALLBACK_MODELS", input.geminiFallbackModels, problems, 5);

  const baseUrl = parseBaseUrl(input.openRouterBaseUrl, problems, warnings);
  const timeoutMs = parseInteger("OPENROUTER_TIMEOUT_MS", input.openRouterTimeoutMs, DEFAULT_OPENROUTER_TIMEOUT_MS, 1_000, 300_000, problems);
  const contextTokens = parseInteger("OPENROUTER_MODEL_CONTEXT_TOKENS", input.openRouterModelContextTokens, 32_768, 1_000, 10_000_000, problems);
  const quotaCooldownMs = parseInteger("AI_QUOTA_COOLDOWN_MS", input.aiQuotaCooldownMs, DEFAULT_QUOTA_COOLDOWN_MS, 0, 86_400_000, problems);

  const discovery = parseBoolean("OPENROUTER_DISCOVERY", input.openRouterDiscovery, true, problems);
  const allowPaid = parseBoolean("OPENROUTER_ALLOW_PAID", input.openRouterAllowPaid, false, problems);
  const fallbackModels = parseModelList("OPENROUTER_FALLBACK_MODELS", input.openRouterFallbackModels, problems);
  const maxPricePromptPerM = parsePrice("OPENROUTER_MAX_PRICE_PROMPT", input.openRouterMaxPricePrompt, problems);
  const maxPriceCompletionPerM = parsePrice("OPENROUTER_MAX_PRICE_COMPLETION", input.openRouterMaxPriceCompletion, problems);
  const maxOutputTokens = blank(input.openRouterMaxOutputTokens)
    ? undefined
    : parseInteger("OPENROUTER_MAX_OUTPUT_TOKENS", input.openRouterMaxOutputTokens, 0, 1, 1_000_000, problems);
  let dataCollection: "allow" | "deny" | undefined;
  if (!blank(input.openRouterDataCollection)) {
    const value = input.openRouterDataCollection!.trim().toLowerCase();
    if (value === "allow" || value === "deny") dataCollection = value;
    else problems.push('OPENROUTER_DATA_COLLECTION must be "allow" or "deny"');
  }
  if (allowPaid && maxPricePromptPerM === undefined && maxPriceCompletionPerM === undefined) {
    warnings.push("OPENROUTER_ALLOW_PAID is on with no OPENROUTER_MAX_PRICE_PROMPT / OPENROUTER_MAX_PRICE_COMPLETION: any paid model OpenRouter lists may be chosen");
  }
  if (!discovery && (fallbackModels.length > 0 || allowPaid)) {
    warnings.push("OPENROUTER_FALLBACK_MODELS / OPENROUTER_ALLOW_PAID have no effect while OPENROUTER_DISCOVERY is off");
  }

  const openRouterModel = blank(input.openRouterModel) ? DEFAULT_OPENROUTER_MODEL : input.openRouterModel!.trim();
  if (!MODEL_ID.test(openRouterModel)) problems.push("OPENROUTER_MODEL is not a valid model id");
  const extraCapabilities = parseCapabilityList(input.openRouterModelCapabilities, problems);

  if (!MODEL_ID.test(input.geminiModel)) problems.push("GEMINI_MODEL is not a valid model id");

  const openAiBaseUrl = parseBaseUrl(input.openAiBaseUrl, problems, warnings, "OPENAI_BASE_URL");
  const openAiTimeoutMs = parseInteger("OPENAI_TIMEOUT_MS", input.openAiTimeoutMs, DEFAULT_OPENROUTER_TIMEOUT_MS, 1_000, 300_000, problems);
  const openAiContextTokens = parseInteger("OPENAI_MODEL_CONTEXT_TOKENS", input.openAiModelContextTokens, 32_768, 1_000, 10_000_000, problems);
  const openAiMaxOutputTokens = blank(input.openAiMaxOutputTokens)
    ? undefined
    : parseInteger("OPENAI_MAX_OUTPUT_TOKENS", input.openAiMaxOutputTokens, 0, 1, 1_000_000, problems);
  const openAiModel = blank(input.openAiModel) ? undefined : input.openAiModel!.trim();
  if (openAiModel !== undefined && !MODEL_ID.test(openAiModel)) problems.push("OPENAI_MODEL is not a valid model id");
  // Unset means the default (tools); "none" means text and streaming only.
  const openAiCapabilities = blank(input.openAiModelCapabilities) ? undefined : parseCapabilityList(input.openAiModelCapabilities, problems, "OPENAI_MODEL_CAPABILITIES");

  const groqBaseUrl = parseBaseUrl(input.groqBaseUrl, problems, warnings, "GROQ_BASE_URL");
  const groqTimeoutMs = parseInteger("GROQ_TIMEOUT_MS", input.groqTimeoutMs, DEFAULT_OPENROUTER_TIMEOUT_MS, 1_000, 300_000, problems);
  const groqContextTokens = parseInteger("GROQ_MODEL_CONTEXT_TOKENS", input.groqModelContextTokens, DEFAULT_GROQ_CONTEXT_TOKENS, 1_000, 10_000_000, problems);
  const groqMaxOutputTokens = blank(input.groqMaxOutputTokens)
    ? undefined
    : parseInteger("GROQ_MAX_OUTPUT_TOKENS", input.groqMaxOutputTokens, 0, 1, 1_000_000, problems);
  const groqModel = blank(input.groqModel) ? DEFAULT_GROQ_MODEL : input.groqModel!.trim();
  if (!MODEL_ID.test(groqModel)) problems.push("GROQ_MODEL is not a valid model id");
  // Unset means the default (tools); "none" means text and streaming only.
  const groqCapabilities = blank(input.groqModelCapabilities) ? undefined : parseCapabilityList(input.groqModelCapabilities, problems, "GROQ_MODEL_CAPABILITIES");

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
    groqEntry({ model: groqModel, capabilities: groqCapabilities, contextTokens: groqContextTokens }),
    geminiEntry(input.geminiModel),
    openRouterEntry({ model: openRouterModel, extraCapabilities, contextTokens }),
    ...(openAiModel ? [openAIEntry({ model: openAiModel, capabilities: openAiCapabilities, contextTokens: openAiContextTokens })] : []),
  ];
  // A provider the JSON mentions is described entirely by the JSON; the simple variables only
  // describe providers the JSON leaves out.
  const listed = new Set(fromJson.map((entry) => entry.provider));
  if (listed.has("openrouter") && (!blank(input.openRouterModel) || !blank(input.openRouterModelCapabilities))) {
    warnings.push("OPENROUTER_MODEL / OPENROUTER_MODEL_CAPABILITIES are ignored because AI_MODEL_CATALOG_JSON lists OpenRouter models");
  }
  const catalog = [...defaults.filter((entry) => !listed.has(entry.provider)), ...fromJson];

  return {
    preferredPrimary,
    preferredFallback: preferredFallbacks[0] ?? null,
    preferredFallbacks,
    geminiFallbackModels,
    catalog,
    openRouter: {
      baseUrl,
      timeoutMs,
      discovery,
      fallbackModels,
      allowPaid,
      ...(maxPricePromptPerM !== undefined ? { maxPricePromptPerM } : {}),
      ...(maxPriceCompletionPerM !== undefined ? { maxPriceCompletionPerM } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(dataCollection ? { dataCollection } : {}),
    },
    openAI: {
      baseUrl: openAiBaseUrl,
      timeoutMs: openAiTimeoutMs,
      ...(openAiModel ? { model: openAiModel } : {}),
      ...(openAiMaxOutputTokens !== undefined ? { maxOutputTokens: openAiMaxOutputTokens } : {}),
    },
    groq: {
      baseUrl: groqBaseUrl,
      timeoutMs: groqTimeoutMs,
      model: groqModel,
      ...(groqMaxOutputTokens !== undefined ? { maxOutputTokens: groqMaxOutputTokens } : {}),
    },
    quotaCooldownMs,
    warnings,
  };
}
