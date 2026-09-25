import type { AIProvider, ModelConfiguration } from "./provider.js";
import { MockAIProvider } from "./mockProvider.js";
import { GeminiProvider } from "./geminiProvider.js";
import { OmniRouteProvider } from "./omniRouteProvider.js";
import { ResilientAIProvider } from "./resilientProvider.js";
import { env } from "../config/env.js";

/**
 * Provider registry. Gemini remains the primary provider when GEMINI_API_KEY is configured.
 * If OmniRoute is also configured, transient Gemini failures automatically fail over to
 * OmniRoute. OmniRoute can also run standalone when Gemini is not configured.
 */
const providers: Record<string, AIProvider> = {
  mock: new MockAIProvider(),
};

const gemini = env.geminiApiKey ? new GeminiProvider(env.geminiApiKey) : undefined;
const omniRoute = env.omniRouteApiKey
  ? new OmniRouteProvider(env.omniRouteApiKey, env.omniRouteModel, env.omniRouteBaseUrl)
  : undefined;

if (gemini) {
  providers.google = omniRoute ? new ResilientAIProvider(gemini, omniRoute) : gemini;
}
if (omniRoute) {
  providers.omniroute = omniRoute;
}

export function getProvider(modelConfig: ModelConfiguration): AIProvider {
  const provider = providers[modelConfig.provider];
  if (!provider) {
    throw new Error(
      `No AIProvider registered for '${modelConfig.provider}'. Available: ${Object.keys(providers).join(", ")}.`,
    );
  }
  return provider;
}

/**
 * Defaults to Gemini when its key is configured. With both Gemini and OmniRoute configured,
 * the Gemini provider gets an automatic transient-failure fallback to OmniRoute. If only
 * OmniRoute is configured, it becomes the real default provider. With neither configured,
 * the deterministic mock keeps local development/tests runnable.
 */
export const defaultModelConfig: ModelConfiguration = gemini
  ? { provider: "google", model: env.geminiModel }
  : omniRoute
    ? { provider: "omniroute", model: env.omniRouteModel }
    : { provider: "mock", model: "mock-v1" };
