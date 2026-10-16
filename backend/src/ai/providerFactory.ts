import type { AIProvider, AIRequest, AIResponse, AIResponseChunk, ModelConfiguration } from "./provider.js";
import { AIProviderError } from "./geminiErrors.js";
import { MockAIProvider } from "./mockProvider.js";
import { GeminiProvider } from "./geminiProvider.js";
import { OpenRouterProvider } from "./openRouterProvider.js";
import { OpenRouterCatalog, OpenRouterModelDirectory } from "./openRouterModels.js";
import { ModelGateway, type GatewayProvider } from "./modelGateway.js";
import { describeEntry, type CatalogProvider } from "./modelCatalog.js";
import { KeyRotatingProvider } from "./keyRotatingProvider.js";
import { resolveAIConfig, DEFAULT_GROQ_MODEL, DEFAULT_OPENROUTER_MODEL } from "../config/aiConfig.js";
import { env } from "../config/env.js";
import { KeyRotator, parseKeyList } from "../security/keyRotator.js";
import { logger } from "../security/redact.js";

/**
 * Composition of the AI layer: which providers exist and how the ModelGateway is built from the
 * environment. Everything else in ZARVIS asks the gateway; nothing else constructs a provider.
 */

/**
 * Production with no AI credential: every model call fails honestly with AI_UNAVAILABLE.
 * The deterministic MockAIProvider is for development and tests only; in production its
 * canned replies ("I'm not sure which skill can help with that yet…") would reach users as if
 * the AI had answered. Generation skills and web search already fail closed the same way
 * (skills/index.ts).
 */
export class UnavailableAIProvider implements AIProvider {
  readonly id = "none";
  async generate(_request: AIRequest): Promise<AIResponse> {
    throw unavailable();
  }
  // eslint-disable-next-line require-yield
  async *streamGenerate(_request: AIRequest): AsyncIterable<AIResponseChunk> {
    throw unavailable();
  }
}

function unavailable(): AIProviderError {
  return new AIProviderError("No AI provider is configured (set GROQ_KEYS, OPENROUTER_KEYS, GEMINI_KEYS, or OPENAI_KEYS with OPENAI_MODEL)", "AI_UNAVAILABLE", 503, false);
}

/** Which provider answers by default, in the default order (Groq, OpenRouter, Gemini). Exported for tests. */
export function selectDefaultModel(options: {
  hasGeminiKey: boolean;
  isProduction: boolean;
  geminiModel: string;
  hasOpenRouterKey?: boolean;
  openRouterModel?: string;
  hasGroqKey?: boolean;
  groqModel?: string;
}): ModelConfiguration {
  if (options.hasGroqKey) return { provider: "groq", model: options.groqModel ?? DEFAULT_GROQ_MODEL };
  if (options.hasOpenRouterKey) return { provider: "openrouter", model: options.openRouterModel ?? DEFAULT_OPENROUTER_MODEL };
  if (options.hasGeminiKey) return { provider: "google", model: options.geminiModel };
  return options.isProduction ? { provider: "none", model: "none" } : { provider: "mock", model: "mock-v1" };
}

/**
 * The default model at the moment this module loads. Kept for callers that want a plain
 * `ModelConfiguration`; routing never reads it (the gateway chooses the model per request).
 */
export const defaultModelConfig: ModelConfiguration = selectDefaultModel({
  hasGeminiKey: !!env.geminiApiKey,
  isProduction: env.isProduction,
  geminiModel: env.geminiModel,
  hasOpenRouterKey: !!env.openRouterApiKey,
  openRouterModel: env.openRouterModel?.trim() || undefined,
  hasGroqKey: !!env.groqApiKey,
  groqModel: env.groqModel?.trim() || undefined,
});

/** The settings the gateway reads. `env` satisfies it; a test can pass its own. */
export type GatewayEnvironment = Pick<
  typeof env,
  | "geminiApiKey"
  | "geminiModel"
  | "geminiFallbackModels"
  | "openRouterApiKey"
  | "openRouterBaseUrl"
  | "openRouterModel"
  | "openRouterModelCapabilities"
  | "openRouterModelContextTokens"
  | "openRouterTimeoutMs"
  | "openRouterDiscovery"
  | "openRouterFallbackModels"
  | "openRouterAllowPaid"
  | "openRouterMaxPricePrompt"
  | "openRouterMaxPriceCompletion"
  | "openRouterMaxOutputTokens"
  | "openRouterDataCollection"
  | "openAiApiKey"
  | "openAiBaseUrl"
  | "openAiModel"
  | "openAiModelCapabilities"
  | "openAiModelContextTokens"
  | "openAiTimeoutMs"
  | "openAiMaxOutputTokens"
  | "aiPrimaryProvider"
  | "aiFallbackProvider"
  | "aiModelCatalogJson"
  | "aiQuotaCooldownMs"
> &
  // Optional, so a caller written before them (a probe, a test) still compiles: absent = no such keys / defaults.
  Partial<
    Pick<
      typeof env,
      | "geminiKeys"
      | "openRouterKeys"
      | "openAiKeys"
      | "groqKeys"
      | "groqApiKey"
      | "groqBaseUrl"
      | "groqModel"
      | "groqModelCapabilities"
      | "groqModelContextTokens"
      | "groqTimeoutMs"
      | "groqMaxOutputTokens"
    >
  >;

export interface CreateGatewayOptions {
  isProduction?: boolean;
  now?: () => number;
}

/**
 * Builds a gateway. Validates every AI setting first and throws an `AIConfigError` (variable names
 * only, never a value) when one is present and wrong. Credentials are read per request through
 * the source object, and registered with the log redactor the first time they are used.
 *
 * Every provider can have several keys (`GROQ_KEYS=k1,k2`): each one is a `KeyRotatingProvider`, which tries
 * the next key when one is rate limited, out of quota or refused, before the gateway moves on to the next
 * provider. With one key it behaves exactly like the provider alone.
 */
export function createModelGateway(source: GatewayEnvironment = env, options: CreateGatewayOptions = {}): ModelGateway {
  const isProduction = options.isProduction ?? env.isProduction;
  const config = resolveAIConfig({
    geminiModel: source.geminiModel,
    geminiFallbackModels: source.geminiFallbackModels,
    aiPrimaryProvider: source.aiPrimaryProvider,
    aiFallbackProvider: source.aiFallbackProvider,
    openRouterBaseUrl: source.openRouterBaseUrl,
    openRouterModel: source.openRouterModel,
    openRouterModelCapabilities: source.openRouterModelCapabilities,
    openRouterModelContextTokens: source.openRouterModelContextTokens,
    openRouterTimeoutMs: source.openRouterTimeoutMs,
    openRouterDiscovery: source.openRouterDiscovery,
    openRouterFallbackModels: source.openRouterFallbackModels,
    openRouterAllowPaid: source.openRouterAllowPaid,
    openRouterMaxPricePrompt: source.openRouterMaxPricePrompt,
    openRouterMaxPriceCompletion: source.openRouterMaxPriceCompletion,
    openRouterMaxOutputTokens: source.openRouterMaxOutputTokens,
    openRouterDataCollection: source.openRouterDataCollection,
    openAiBaseUrl: source.openAiBaseUrl,
    openAiModel: source.openAiModel,
    openAiModelCapabilities: source.openAiModelCapabilities,
    openAiModelContextTokens: source.openAiModelContextTokens,
    openAiTimeoutMs: source.openAiTimeoutMs,
    openAiMaxOutputTokens: source.openAiMaxOutputTokens,
    groqBaseUrl: source.groqBaseUrl,
    groqModel: source.groqModel,
    groqModelCapabilities: source.groqModelCapabilities,
    groqModelContextTokens: source.groqModelContextTokens,
    groqTimeoutMs: source.groqTimeoutMs,
    groqMaxOutputTokens: source.groqMaxOutputTokens,
    aiModelCatalogJson: source.aiModelCatalogJson,
    aiQuotaCooldownMs: source.aiQuotaCooldownMs,
  });

  // One rotator per provider. The list is read from `source` on every use (the list, then the single-key field),
  // so a key set after the gateway was built is picked up; each key is registered with the log redactor.
  const rotator = (name: string, list: () => readonly string[] | undefined, single: () => string | undefined) =>
    new KeyRotator({ name, keys: () => parseKeyList(list(), single()), now: options.now });
  const keys: Record<CatalogProvider, KeyRotator> = {
    groq: rotator("GROQ", () => source.groqKeys, () => source.groqApiKey),
    google: rotator("GEMINI", () => source.geminiKeys, () => source.geminiApiKey),
    openrouter: rotator("OPENROUTER", () => source.openRouterKeys, () => source.openRouterApiKey),
    openai: rotator("OPENAI", () => source.openAiKeys, () => source.openAiApiKey),
  };

  const openRouter = config.openRouter;
  // The model list is read with whichever OpenRouter key requests currently start with.
  const directory = openRouter.discovery
    ? new OpenRouterModelDirectory({ apiKey: () => keys.openrouter.current(), baseUrl: openRouter.baseUrl, now: options.now })
    : undefined;
  const dynamic = directory
    ? new OpenRouterCatalog(
        directory,
        {
          allowPaid: openRouter.allowPaid,
          maxPricePromptPerM: openRouter.maxPricePromptPerM,
          maxPriceCompletionPerM: openRouter.maxPriceCompletionPerM,
          explicitAlternates: openRouter.fallbackModels,
        },
        options.now,
      )
    : undefined;

  const providers: GatewayProvider[] = [
    {
      id: "groq",
      label: "GROQ",
      provider: new KeyRotatingProvider({
        id: "groq",
        rotator: keys.groq,
        supportsJsonSchema: true,
        build: (key, hasAlternative) =>
          new OpenRouterProvider({
            flavor: "groq",
            apiKey: key,
            baseUrl: config.groq.baseUrl,
            timeoutMs: config.groq.timeoutMs,
            policy: config.groq.maxOutputTokens !== undefined ? { maxOutputTokens: config.groq.maxOutputTokens } : {},
            skipRateLimitWait: hasAlternative,
          }),
      }),
      isConfigured: () => keys.groq.hasKeys(),
      keys: keys.groq,
      live: true,
    },
    {
      id: "google",
      label: "GEMINI",
      provider: new KeyRotatingProvider({
        id: "google",
        rotator: keys.google,
        build: (key, hasAlternative) => new GeminiProvider(key, undefined, config.geminiFallbackModels, options.now, { skipRateLimitWait: hasAlternative }),
      }),
      isConfigured: () => keys.google.hasKeys(),
      keys: keys.google,
      live: true,
    },
    {
      id: "openrouter",
      label: "OPENROUTER",
      provider: new KeyRotatingProvider({
        id: "openrouter",
        rotator: keys.openrouter,
        supportsJsonSchema: true,
        build: (key, hasAlternative) =>
          new OpenRouterProvider({
            apiKey: key,
            baseUrl: openRouter.baseUrl,
            timeoutMs: openRouter.timeoutMs,
            policy: {
              dataCollection: openRouter.dataCollection,
              maxPricePromptPerM: openRouter.maxPricePromptPerM,
              maxPriceCompletionPerM: openRouter.maxPriceCompletionPerM,
              maxOutputTokens: openRouter.maxOutputTokens,
            },
            skipRateLimitWait: hasAlternative,
          }),
      }),
      isConfigured: () => keys.openrouter.hasKeys(),
      keys: keys.openrouter,
      live: true,
    },
    {
      id: "openai",
      label: "OPENAI",
      provider: new KeyRotatingProvider({
        id: "openai",
        rotator: keys.openai,
        supportsJsonSchema: true,
        build: (key, hasAlternative) =>
          new OpenRouterProvider({
            flavor: "openai",
            apiKey: key,
            baseUrl: config.openAI.baseUrl,
            timeoutMs: config.openAI.timeoutMs,
            policy: config.openAI.maxOutputTokens !== undefined ? { maxOutputTokens: config.openAI.maxOutputTokens } : {},
            skipRateLimitWait: hasAlternative,
          }),
      }),
      // A key without OPENAI_MODEL is not enough: no model id is assumed for an endpoint this code does not know.
      isConfigured: () => keys.openai.hasKeys() && config.openAI.model !== undefined,
      keys: keys.openai,
      live: true,
    },
    // The deterministic mock exists only outside production; production fails closed.
    ...(isProduction ? [] : [{ id: "mock" as const, label: "MOCK", provider: new MockAIProvider(), isConfigured: () => true, live: false }]),
    { id: "none", label: "NONE", provider: new UnavailableAIProvider(), isConfigured: () => true, live: false },
  ];
  // Reading each list once registers every configured key with the log redactor before the first request.
  for (const pool of Object.values(keys)) pool.hasKeys();

  const gateway = new ModelGateway({
    providers,
    preferredPrimary: config.preferredPrimary,
    preferredFallback: config.preferredFallback,
    preferredFallbacks: config.preferredFallbacks,
    catalog: config.catalog,
    quotaCooldownMs: config.quotaCooldownMs,
    ...(dynamic ? { dynamic: { openrouter: dynamic } } : {}),
    now: options.now,
  });
  const warnings = [...config.warnings];
  if (keys.openai.hasKeys() && config.openAI.model === undefined) {
    warnings.push("OPENAI_KEYS / OPENAI_API_KEY is set without OPENAI_MODEL: the OpenAI-compatible fallback stays off until OPENAI_MODEL names the model");
  }
  startupWarnings.set(gateway, warnings);
  return gateway;
}

/** Findings of the validation that are worth a log line but are not errors. */
const startupWarnings = new WeakMap<ModelGateway, string[]>();

let sharedGateway: ModelGateway | undefined;

/**
 * The process-wide gateway built from `env`. Created on first use (the container build), which is
 * where an invalid AI setting stops the server with a clear message.
 */
export function getModelGateway(): ModelGateway {
  if (!sharedGateway) {
    sharedGateway = createModelGateway(env);
    logStartup(sharedGateway);
  }
  return sharedGateway;
}

/** One line per cold start: what the AI layer will do. Names models and capabilities, never a key. */
function logStartup(gateway: ModelGateway): void {
  const status = gateway.getProviderStatus();
  const notes: string[] = [...(startupWarnings.get(gateway) ?? [])];
  const fallbacks = status.providers.filter((provider) => status.effective.fallbacks.includes(provider.id as never));
  if (fallbacks.length > 0 && !fallbacks.some((provider) => provider.models.some((model) => model.enabled && model.capabilities.includes("tools")))) {
    notes.push("No fallback model declares tool support: tool-using chat turns will not fall back (see OPENROUTER_MODEL_CAPABILITIES / OPENAI_MODEL_CAPABILITIES / AI_MODEL_CATALOG_JSON)");
  }
  logger.info("AI gateway ready", {
    mode: status.effective.mode,
    primary: status.effective.primary,
    fallback: status.effective.fallback,
    fallbacks: status.effective.fallbacks,
    preferred: status.preferred,
    providers: status.providers
      .filter((provider) => provider.live)
      .map((provider) => ({
        id: provider.id,
        configured: provider.configured,
        // How many keys each provider has (never a key): "keys: 3" says rotation is on.
        ...(provider.keys ? { keys: provider.keys.total } : {}),
        models: provider.models.map((model) => ({ ...model })),
      })),
    ...(notes.length > 0 ? { notes } : {}),
  });
}

/** For tests: forget the shared gateway so the next `getModelGateway()` rebuilds it from `env`. */
export function resetModelGatewayForTests(): void {
  sharedGateway = undefined;
}

export { describeEntry };
