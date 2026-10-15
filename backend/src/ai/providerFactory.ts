import type { AIProvider, AIRequest, AIResponse, AIResponseChunk, ModelConfiguration } from "./provider.js";
import { AIProviderError } from "./geminiErrors.js";
import { MockAIProvider } from "./mockProvider.js";
import { GeminiProvider } from "./geminiProvider.js";
import { OpenRouterProvider } from "./openRouterProvider.js";
import { ModelGateway, type GatewayProvider } from "./modelGateway.js";
import { describeEntry } from "./modelCatalog.js";
import { resolveAIConfig, DEFAULT_OPENROUTER_MODEL } from "../config/aiConfig.js";
import { env } from "../config/env.js";
import { logger, registerSecret } from "../security/redact.js";

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
  return new AIProviderError("No AI provider is configured (set GEMINI_API_KEY or OPENROUTER_API_KEY)", "AI_UNAVAILABLE", 503, false);
}

/** Which provider answers by default. Exported for tests. */
export function selectDefaultModel(options: {
  hasGeminiKey: boolean;
  isProduction: boolean;
  geminiModel: string;
  hasOpenRouterKey?: boolean;
  openRouterModel?: string;
}): ModelConfiguration {
  if (options.hasGeminiKey) return { provider: "google", model: options.geminiModel };
  if (options.hasOpenRouterKey) return { provider: "openrouter", model: options.openRouterModel ?? DEFAULT_OPENROUTER_MODEL };
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
});

/** The settings the gateway reads. `env` satisfies it; a test can pass its own. */
export type GatewayEnvironment = Pick<
  typeof env,
  | "geminiApiKey"
  | "geminiModel"
  | "openRouterApiKey"
  | "openRouterBaseUrl"
  | "openRouterModel"
  | "openRouterModelCapabilities"
  | "openRouterModelContextTokens"
  | "openRouterTimeoutMs"
  | "aiPrimaryProvider"
  | "aiFallbackProvider"
  | "aiModelCatalogJson"
  | "aiQuotaCooldownMs"
>;

export interface CreateGatewayOptions {
  isProduction?: boolean;
  now?: () => number;
}

/**
 * Builds a gateway. Validates every AI setting first and throws an `AIConfigError` (variable names
 * only, never a value) when one is present and wrong. Credentials are read per request through
 * the source object, and registered with the log redactor the first time they are used.
 */
export function createModelGateway(source: GatewayEnvironment = env, options: CreateGatewayOptions = {}): ModelGateway {
  const isProduction = options.isProduction ?? env.isProduction;
  const config = resolveAIConfig({
    geminiModel: source.geminiModel,
    aiPrimaryProvider: source.aiPrimaryProvider,
    aiFallbackProvider: source.aiFallbackProvider,
    openRouterBaseUrl: source.openRouterBaseUrl,
    openRouterModel: source.openRouterModel,
    openRouterModelCapabilities: source.openRouterModelCapabilities,
    openRouterModelContextTokens: source.openRouterModelContextTokens,
    openRouterTimeoutMs: source.openRouterTimeoutMs,
    aiModelCatalogJson: source.aiModelCatalogJson,
    aiQuotaCooldownMs: source.aiQuotaCooldownMs,
  });

  const geminiKey = () => {
    const key = source.geminiApiKey;
    registerSecret(key);
    return key;
  };
  const openRouterKey = () => {
    const key = source.openRouterApiKey;
    registerSecret(key);
    return key;
  };

  const providers: GatewayProvider[] = [
    { id: "google", label: "GEMINI", provider: new GeminiProvider(geminiKey), isConfigured: () => !!source.geminiApiKey, live: true },
    {
      id: "openrouter",
      label: "OPENROUTER",
      provider: new OpenRouterProvider({ apiKey: openRouterKey, baseUrl: config.openRouter.baseUrl, timeoutMs: config.openRouter.timeoutMs }),
      isConfigured: () => !!source.openRouterApiKey,
      live: true,
    },
    // The deterministic mock exists only outside production; production fails closed.
    ...(isProduction ? [] : [{ id: "mock" as const, label: "MOCK", provider: new MockAIProvider(), isConfigured: () => true, live: false }]),
    { id: "none", label: "NONE", provider: new UnavailableAIProvider(), isConfigured: () => true, live: false },
  ];
  registerSecret(source.geminiApiKey);
  registerSecret(source.openRouterApiKey);

  const gateway = new ModelGateway({
    providers,
    preferredPrimary: config.preferredPrimary,
    preferredFallback: config.preferredFallback,
    catalog: config.catalog,
    quotaCooldownMs: config.quotaCooldownMs,
    now: options.now,
  });
  startupWarnings.set(gateway, config.warnings);
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
  const fallback = status.providers.find((provider) => provider.id === status.effective.fallback);
  if (fallback && !fallback.models.some((model) => model.enabled && model.capabilities.includes("tools"))) {
    notes.push("The fallback model does not declare tool support: tool-using chat turns will not fall back (see OPENROUTER_MODEL_CAPABILITIES / AI_MODEL_CATALOG_JSON)");
  }
  logger.info("AI gateway ready", {
    mode: status.effective.mode,
    primary: status.effective.primary,
    fallback: status.effective.fallback,
    preferred: status.preferred,
    providers: status.providers
      .filter((provider) => provider.live)
      .map((provider) => ({ id: provider.id, configured: provider.configured, models: provider.models.map((model) => ({ ...model })) })),
    ...(notes.length > 0 ? { notes } : {}),
  });
}

/** For tests: forget the shared gateway so the next `getModelGateway()` rebuilds it from `env`. */
export function resetModelGatewayForTests(): void {
  sharedGateway = undefined;
}

export { describeEntry };
