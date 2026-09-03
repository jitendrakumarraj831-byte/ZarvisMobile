import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, ModelConfiguration } from "./provider.js";
import { AnthropicAIProvider } from "./anthropicProvider.js";
import { MockAIProvider } from "./mockProvider.js";
import { env } from "../config/env.js";

/**
 * Resolves an [AIProvider] for a given [ModelConfiguration] — see AI_ARCHITECTURE.md.
 *
 * [MockAIProvider] is always registered (deterministic, zero-credential, used in CI and
 * local dev with no `.env`). [AnthropicAIProvider] is registered only when `ANTHROPIC_API_KEY`
 * is set — adding a further provider (OpenAI/Google) is the same pattern: implement
 * [AIProvider] once and register it below by `modelConfig.provider`; no caller of
 * `getProvider` needs to change.
 */
const providers: Record<string, AIProvider> = {
  mock: new MockAIProvider(),
  ...(env.anthropicApiKey
    ? { anthropic: new AnthropicAIProvider(new Anthropic({ apiKey: env.anthropicApiKey }).messages, env.anthropicModel) }
    : {}),
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

/**
 * Uses AnthropicAIProvider automatically once `ANTHROPIC_API_KEY` is configured; falls back
 * to MockAIProvider with no credentials required (default for local dev and CI).
 */
export const defaultModelConfig: ModelConfiguration = env.anthropicApiKey
  ? { provider: "anthropic", model: env.anthropicModel }
  : { provider: "mock", model: "mock-v1" };
