import type { AIProvider, ModelConfiguration } from "./provider.js";
import { MockAIProvider } from "./mockProvider.js";
import { GeminiProvider } from "./geminiProvider.js";
import { env } from "../config/env.js";

/**
 * Provider registry. Each provider is called directly from the backend.
 * No gateway/proxy is used here: configure the provider key you want to use
 * and select/register that provider in this factory.
 */
const providers: Record<string, AIProvider> = {
  mock: new MockAIProvider(),
};

const gemini = env.geminiApiKey ? new GeminiProvider(env.geminiApiKey) : undefined;

if (gemini) {
  providers.google = gemini;
}

/**
 * Defaults to Gemini when its key is configured. With no real provider configured,
 * the deterministic mock keeps local development/tests runnable.
 */
export const defaultModelConfig: ModelConfiguration = gemini
  ? { provider: "google", model: env.geminiModel }
  : { provider: "mock", model: "mock-v1" };

export function getProvider(modelConfig: ModelConfiguration): AIProvider {
  const provider = providers[modelConfig.provider];
  if (!provider) {
    throw new Error(
      `No AIProvider registered for '${modelConfig.provider}'. Available: ${Object.keys(providers).join(", ")}.`,
    );
  }
  return provider;
}
