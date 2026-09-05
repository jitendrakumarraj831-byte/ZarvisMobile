import type { AIProvider, ModelConfiguration } from "./provider.js";
import { MockAIProvider } from "./mockProvider.js";
import { GeminiProvider } from "./geminiProvider.js";
import { env } from "../config/env.js";

/**
 * Resolves an [AIProvider] for a given [ModelConfiguration] — see AI_ARCHITECTURE.md.
 *
 * [MockAIProvider] (`id: "mock"`) is always registered so the product runs and is
 * demoable/testable with zero external credentials. [GeminiProvider] (`id: "google"`) is
 * registered whenever `GEMINI_API_KEY` is configured (config/env.ts) — this repository's
 * first wired real provider. Adding another (Anthropic/OpenAI) is additive: implement
 * [AIProvider] and register it below by `modelConfig.provider`; no caller of `getProvider`
 * needs to change.
 */
const providers: Record<string, AIProvider> = {
  mock: new MockAIProvider(),
  ...(env.geminiApiKey ? { google: new GeminiProvider(env.geminiApiKey) } : {}),
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
 * The turn-loop's default model config (AI_ARCHITECTURE.md "Model configuration"). Resolves
 * to Gemini automatically once `GEMINI_API_KEY` is set, degrading gracefully to the
 * zero-credential [MockAIProvider] otherwise — see MASTER_SPEC.md §10 "Important constraint"
 * (a developer's own AI subscription is never assumed; production traffic uses a
 * server-held key configured via environment, exactly as `GEMINI_API_KEY` is here).
 */
export const defaultModelConfig: ModelConfiguration = env.geminiApiKey
  ? { provider: "google", model: env.geminiModel }
  : { provider: "mock", model: "mock-v1" };
