import { describe, expect, it } from "vitest";
import { searchProvider, type SearchProviderSettings } from "../../src/skills/index.js";
import {
  FallbackSearchProvider,
  GeminiSearchProvider,
  MockSearchProvider,
  OpenRouterSearchProvider,
  UnavailableSearchProvider,
} from "../../src/skills/webSearch.js";

const base: SearchProviderSettings = { geminiModel: "gemini-3.6-flash", isProduction: true };

describe("which web-search provider a deployment gets", () => {
  it("Gemini alone when only the Gemini key is set", () => {
    expect(searchProvider({ ...base, geminiApiKey: "g" })).toBeInstanceOf(GeminiSearchProvider);
  });

  it("Gemini with OpenRouter behind it when both keys are set", () => {
    expect(searchProvider({ ...base, geminiApiKey: "g", openRouterApiKey: "o" })).toBeInstanceOf(FallbackSearchProvider);
  });

  it.each(["none", "NONE", " off ", "disabled"])(
    "AI_FALLBACK_PROVIDER=%s keeps a search query away from OpenRouter while Gemini is configured",
    (setting) => {
      const provider = searchProvider({ ...base, geminiApiKey: "g", openRouterApiKey: "o", aiFallbackProvider: setting });
      expect(provider).toBeInstanceOf(GeminiSearchProvider);
    },
  );

  it("OpenRouter alone when it is the only provider with a key", () => {
    expect(searchProvider({ ...base, openRouterApiKey: "o" })).toBeInstanceOf(OpenRouterSearchProvider);
    expect(searchProvider({ ...base, openRouterApiKey: "o", aiFallbackProvider: "none" })).toBeInstanceOf(OpenRouterSearchProvider);
  });

  it("is honestly unavailable in production with no key, and a labelled mock elsewhere", () => {
    expect(searchProvider(base)).toBeInstanceOf(UnavailableSearchProvider);
    expect(searchProvider({ ...base, isProduction: false })).toBeInstanceOf(MockSearchProvider);
  });
});
