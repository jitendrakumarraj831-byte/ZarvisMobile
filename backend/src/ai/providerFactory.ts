import type { AIProvider, AIRequest, AIResponse, AIResponseChunk, ModelConfiguration } from "./provider.js";
import { AIProviderError } from "./geminiErrors.js";
import { MockAIProvider } from "./mockProvider.js";
import { GeminiProvider } from "./geminiProvider.js";
import { OpenRouterProvider } from "./openRouterProvider.js";
import { FallbackProvider } from "./fallbackProvider.js";
import { env } from "../config/env.js";

/**
 * Provider registry. Each provider is called directly from the backend.
 * No gateway/proxy is used here: configure the provider key you want to use
 * and select/register that provider in this factory.
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
  return new AIProviderError("No AI provider is configured (neither GEMINI_API_KEY nor OPENROUTER_API_KEY is set)", "AI_UNAVAILABLE", 503, false);
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
  if (options.hasOpenRouterKey) return { provider: "openrouter", model: options.openRouterModel ?? "openrouter/auto" };
  return options.isProduction ? { provider: "none", model: "none" } : { provider: "mock", model: "mock-v1" };
}

const providers: Record<string, AIProvider> = {
  mock: new MockAIProvider(),
  none: new UnavailableAIProvider(),
};

const gemini = env.geminiApiKey ? new GeminiProvider(env.geminiApiKey) : undefined;

const openRouter = env.openRouterApiKey ? new OpenRouterProvider(env.openRouterApiKey) : undefined;

if (openRouter) {
  providers.openrouter = openRouter;
}

if (gemini) {
  // With an OpenRouter key too, any Gemini failure (quota, outage, bad key) is answered by OpenRouter.
  providers.google = openRouter ? new FallbackProvider(gemini, openRouter, env.openRouterModel) : gemini;
}

/**
 * Defaults to Gemini when its key is configured. With no real provider configured, the
 * deterministic mock keeps local development/tests runnable, and production fails closed
 * ("none", reported as such by /health).
 */
export const defaultModelConfig: ModelConfiguration = selectDefaultModel({
  hasGeminiKey: !!gemini,
  isProduction: env.isProduction,
  geminiModel: env.geminiModel,
  hasOpenRouterKey: !!openRouter,
  openRouterModel: env.openRouterModel,
});

export function getProvider(modelConfig: ModelConfiguration): AIProvider {
  const provider = providers[modelConfig.provider];
  if (!provider) {
    throw new Error(
      `No AIProvider registered for '${modelConfig.provider}'. Available: ${Object.keys(providers).join(", ")}.`,
    );
  }
  return provider;
}
