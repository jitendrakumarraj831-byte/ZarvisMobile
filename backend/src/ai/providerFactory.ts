import type { AIProvider, ModelConfiguration } from "./provider.js";
import { MockAIProvider } from "./mockProvider.js";

/**
 * Resolves an [AIProvider] for a given [ModelConfiguration] — see AI_ARCHITECTURE.md.
 *
 * This build only registers [MockAIProvider]: no live AI provider credentials are wired in
 * this pass (MASTER_SPEC.md §29, §32). Adding a real provider (Anthropic/OpenAI/Google) is
 * additive — implement [AIProvider] and register it below by `modelConfig.provider`; no
 * caller of `getProvider` needs to change.
 */
const providers: Record<string, AIProvider> = {
  mock: new MockAIProvider(),
};

export function getProvider(modelConfig: ModelConfiguration): AIProvider {
  const provider = providers[modelConfig.provider];
  if (!provider) {
    throw new Error(
      `No AIProvider registered for '${modelConfig.provider}'. Available: ${Object.keys(providers).join(", ")}. ` +
        "See AI_ARCHITECTURE.md to add a real provider adapter.",
    );
  }
  return provider;
}

export const defaultModelConfig: ModelConfiguration = { provider: "mock", model: "mock-v1" };
