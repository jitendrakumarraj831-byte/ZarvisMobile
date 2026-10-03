import { AIConfigError } from "../config/aiConfigError.js";
import { CAPABILITIES, capabilitySet, type Capability, type CapabilitySet, type Requirements } from "./capabilities.js";

/**
 * The capability-aware model configuration: which models exist, what each one declares it can
 * do, and in what order they are preferred. The gateway reads nothing else when it decides
 * where a request may go.
 *
 * Capabilities are *declared*, never probed and never assumed. The Gemini entry declares what
 * this repository already relies on in production (function calling, image input, streaming) and
 * what Google documents for the Gemini Flash family. An OpenRouter model declares only text and
 * streaming unless the operator states more (`OPENROUTER_MODEL_CAPABILITIES` or
 * `AI_MODEL_CATALOG_JSON`), because free models differ widely: many cannot call tools or read
 * images, and a router such as `openrouter/free` may serve a different model on each request.
 */
export const CATALOG_PROVIDERS = ["google", "openrouter"] as const;
export type CatalogProvider = (typeof CATALOG_PROVIDERS)[number];

export interface ModelEntry {
  provider: CatalogProvider;
  model: string;
  enabled: boolean;
  /** Informational (shown in status and logs): free models are heavily rate limited. */
  free: boolean;
  /** Lower is preferred. Ties keep declaration order. */
  priority: number;
  capabilities: CapabilitySet;
  contextTokens: number;
  /** Image MIME types this model accepts. Empty unless `vision`. */
  imageMimeTypes: readonly string[];
}

/** The image types the upload route accepts (`api/routes/documents.ts`). */
const UPLOADABLE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"] as const;
export const GEMINI_IMAGE_MIME_TYPES: readonly string[] = UPLOADABLE_IMAGE_TYPES;
/** Vision models behind OpenRouter reliably accept these; HEIC/HEIF are not generally supported. */
export const OPENROUTER_IMAGE_MIME_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp"];

const DEFAULT_CONTEXT_TOKENS = 32_768;

export function geminiEntry(model: string): ModelEntry {
  const contextTokens = 1_000_000;
  return {
    provider: "google",
    model,
    enabled: true,
    free: false,
    priority: 1,
    contextTokens,
    capabilities: capabilitySet(["streaming", "tools", "vision", "structuredOutput", "coding", "reasoning"], contextTokens),
    imageMimeTypes: GEMINI_IMAGE_MIME_TYPES,
  };
}

export function isFreeOpenRouterModel(model: string): boolean {
  return model === "openrouter/free" || model.endsWith(":free");
}

export function openRouterEntry(options: { model: string; extraCapabilities?: Capability[]; contextTokens?: number }): ModelEntry {
  const extra = options.extraCapabilities ?? [];
  const contextTokens = options.contextTokens ?? DEFAULT_CONTEXT_TOKENS;
  return {
    provider: "openrouter",
    model: options.model,
    enabled: true,
    free: isFreeOpenRouterModel(options.model),
    priority: 2,
    contextTokens,
    capabilities: capabilitySet(["streaming", ...extra], contextTokens),
    imageMimeTypes: extra.includes("vision") ? OPENROUTER_IMAGE_MIME_TYPES : [],
  };
}

/** Why `entry` cannot serve `needs`. Empty means it can. Names only; no values from user content. */
export function missingCapabilities(entry: ModelEntry, needs: Requirements): string[] {
  const missing: string[] = [];
  for (const capability of needs.capabilities) {
    if (!entry.capabilities[capability]) missing.push(capability);
  }
  const demand = needs.estimatedPromptTokens + needs.maxOutputTokens;
  if (demand > entry.contextTokens) missing.push(`context(${demand}>${entry.contextTokens})`);
  if (needs.imageMimeType && entry.capabilities.vision && !entry.imageMimeTypes.includes(needs.imageMimeType)) {
    missing.push(`imageType(${needs.imageMimeType})`);
  }
  return missing;
}

export type EntryChoice = { entry: ModelEntry; missing: [] } | { entry: undefined; missing: string[] };

/** The most preferred enabled model of `provider` that can serve `needs`, or why none can. */
export function chooseEntry(catalog: readonly ModelEntry[], provider: CatalogProvider, needs: Requirements): EntryChoice {
  const candidates = catalog
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.provider === provider && entry.enabled)
    .sort((a, b) => a.entry.priority - b.entry.priority || a.index - b.index);
  if (candidates.length === 0) return { entry: undefined, missing: ["no_enabled_model"] };
  let firstMissing: string[] | undefined;
  for (const { entry } of candidates) {
    const missing = missingCapabilities(entry, needs);
    if (missing.length === 0) return { entry, missing: [] };
    firstMissing ??= missing;
  }
  return { entry: undefined, missing: firstMissing ?? [] };
}

// ---- AI_MODEL_CATALOG_JSON ----------------------------------------------------------------------

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const FLAG_KEYS = ["streaming", "tools", "vision", "structuredOutput", "coding", "reasoning"] as const satisfies readonly Capability[];
const ALLOWED_KEYS: ReadonlySet<string> = new Set(["provider", "model", "enabled", "free", "priority", "contextTokens", "imageMimeTypes", ...FLAG_KEYS]);
const MAX_CATALOG_ENTRIES = 50;

function normalizeCatalogProvider(value: unknown): CatalogProvider | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "gemini" || v === "google") return "google";
  if (v === "openrouter") return "openrouter";
  return undefined;
}

/**
 * Parses `AI_MODEL_CATALOG_JSON`, a JSON array in the shape the operator documentation shows:
 *
 *   [{"provider":"openrouter","model":"…","enabled":true,"free":true,"streaming":true,"tools":false,
 *     "vision":false,"priority":2,"contextTokens":32768}]
 *
 * Strict on purpose: an unknown key is almost always a typo (`tool` for `tools`), and a typo that
 * silently leaves a capability off or on would route requests to the wrong model. Anything not
 * stated is the conservative value (no capability, 32k context). Errors name the entry index and
 * the key, never a value.
 */
export function parseCatalogJson(text: string): ModelEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AIConfigError(["AI_MODEL_CATALOG_JSON is not valid JSON"]);
  }
  if (!Array.isArray(parsed)) throw new AIConfigError(["AI_MODEL_CATALOG_JSON must be a JSON array of model entries"]);
  if (parsed.length > MAX_CATALOG_ENTRIES) throw new AIConfigError([`AI_MODEL_CATALOG_JSON has more than ${MAX_CATALOG_ENTRIES} entries`]);

  const problems: string[] = [];
  const entries: ModelEntry[] = [];
  const seen = new Set<string>();
  parsed.forEach((raw, index) => {
    const at = `AI_MODEL_CATALOG_JSON[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      problems.push(`${at} must be an object`);
      return;
    }
    const item = raw as Record<string, unknown>;
    for (const key of Object.keys(item)) {
      if (key === "longContext") problems.push(`${at}.longContext is derived from contextTokens (>= 100000) and cannot be set`);
      else if (!ALLOWED_KEYS.has(key)) problems.push(`${at} has an unknown key "${key.slice(0, 40)}"`);
    }
    const provider = normalizeCatalogProvider(item.provider);
    if (!provider) problems.push(`${at}.provider must be "gemini" or "openrouter"`);
    const model = typeof item.model === "string" ? item.model.trim() : "";
    if (!MODEL_ID.test(model)) problems.push(`${at}.model is missing or not a valid model id`);
    for (const key of ["enabled", "free", ...FLAG_KEYS]) {
      if (item[key] !== undefined && typeof item[key] !== "boolean") problems.push(`${at}.${key} must be true or false`);
    }
    const priority = item.priority === undefined ? 10 : item.priority;
    if (typeof priority !== "number" || !Number.isInteger(priority) || priority < 0 || priority > 1000) {
      problems.push(`${at}.priority must be an integer from 0 to 1000`);
    }
    const contextTokens = item.contextTokens === undefined ? DEFAULT_CONTEXT_TOKENS : item.contextTokens;
    if (typeof contextTokens !== "number" || !Number.isInteger(contextTokens) || contextTokens < 1000 || contextTokens > 10_000_000) {
      problems.push(`${at}.contextTokens must be an integer from 1000 to 10000000`);
    }
    let imageMimeTypes: string[] | undefined;
    if (item.imageMimeTypes !== undefined) {
      const listed = item.imageMimeTypes;
      if (!Array.isArray(listed) || listed.some((type) => typeof type !== "string" || !(UPLOADABLE_IMAGE_TYPES as readonly string[]).includes(type))) {
        problems.push(`${at}.imageMimeTypes must list only: ${UPLOADABLE_IMAGE_TYPES.join(", ")}`);
      } else {
        imageMimeTypes = listed as string[];
      }
    }
    if (!provider || !MODEL_ID.test(model) || problems.some((p) => p.startsWith(at))) return;

    const key = `${provider}/${model}`;
    if (seen.has(key)) {
      problems.push(`${at} repeats a provider and model already listed`);
      return;
    }
    seen.add(key);

    const flags = FLAG_KEYS.filter((flag) => item[flag] === true);
    const tokens = contextTokens as number;
    const vision = flags.includes("vision");
    entries.push({
      provider,
      model,
      enabled: item.enabled !== false,
      free: typeof item.free === "boolean" ? item.free : provider === "openrouter" && isFreeOpenRouterModel(model),
      priority: priority as number,
      contextTokens: tokens,
      capabilities: capabilitySet(flags, tokens),
      imageMimeTypes: vision ? (imageMimeTypes ?? (provider === "google" ? GEMINI_IMAGE_MIME_TYPES : OPENROUTER_IMAGE_MIME_TYPES)) : [],
    });
  });
  if (problems.length > 0) throw new AIConfigError(problems);
  return entries;
}

/** A readable, secret-free capability matrix row (status endpoints, logs, documentation). */
export function describeEntry(entry: ModelEntry) {
  return {
    provider: entry.provider,
    model: entry.model,
    enabled: entry.enabled,
    free: entry.free,
    priority: entry.priority,
    contextTokens: entry.contextTokens,
    capabilities: CAPABILITIES.filter((capability) => entry.capabilities[capability]),
    imageMimeTypes: [...entry.imageMimeTypes],
  };
}
