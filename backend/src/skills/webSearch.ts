import type { SkillDefinition } from "../domain/types.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  search(query: string): Promise<SearchResult[]>;
}

/**
 * Real Google Search grounding through Gemini. Gemini performs the search and returns
 * grounding metadata containing source URLs/titles; no separate search API key is needed.
 */
export class GeminiSearchProvider implements SearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = "gemini-3.6-flash",
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta",
  ) {}

  async search(query: string): Promise<SearchResult[]> {
    const response = await fetch(
      `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text:
                `Search the web for: ${query}. Return a concise answer and rely on current web sources. Do not invent sources.`,
            }],
          }],
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
        }),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Gemini Google Search failed: ${response.status} ${response.statusText} ${detail}`.trim());
    }

    const json = (await response.json()) as GeminiSearchResponse;
    const candidate = json.candidates?.[0];
    const answer = candidate?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    const results: SearchResult[] = [];

    for (const chunk of chunks) {
      const web = chunk.web;
      if (!web?.uri || results.some((result) => result.url === web.uri)) continue;
      results.push({
        title: web.title || new URL(web.uri).hostname,
        url: web.uri,
        snippet: answer.slice(0, 500),
      });
      if (results.length >= 8) break;
    }
    return results;
  }
}

interface GeminiSearchResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
}

/** Deterministic fallback used only when GEMINI_API_KEY is not configured (local/tests). */
export class MockSearchProvider implements SearchProvider {
  async search(query: string): Promise<SearchResult[]> {
    return [
      {
        title: `Mock result 1 for "${query}"`,
        url: "https://example.com/result-1",
        snippet: "No live search provider is configured in this build.",
      },
      {
        title: `Mock result 2 for "${query}"`,
        url: "https://example.com/result-2",
        snippet: "Configure GEMINI_API_KEY to enable live Google Search grounding.",
      },
    ];
  }
}

export function createWebSearchSkill(provider: SearchProvider): SkillDefinition {
  return {
    id: "web.search",
    name: "Web Search",
    description: "Search the live web and return sourced results, e.g. \"find the best phone under 20000\".",
    category: "WEB",
    capabilities: ["search", "find", "compare", "research", "look up", "latest", "current"],
    requiredPermissions: [],
    requiredEntitlement: "FREE",
    usageCost: { value: 2, unit: "credits" },
    riskLevel: "LOW",
    requiresConfirmation: false,
    executesOnDevice: false,
    inputSchema: { requiredFields: ["query"], properties: { query: "string" } },
    handler: async (input) => {
      const query = String(input.values.query ?? "").trim();
      if (!query) {
        return { kind: "failure", reason: "missing_query", userMessage: "What would you like me to search for?" };
      }
      const results = await provider.search(query);
      if (results.length === 0) {
        return { kind: "failure", reason: "no_results", userMessage: `I couldn't find sourced web results for "${query}".` };
      }
      return {
        kind: "success",
        output: { query, results },
        summary:
          `Found ${results.length} live web source(s) for "${query}". Top sources: ` +
          results.slice(0, 3).map((result) => `${result.title} — ${result.url}`).join(" | "),
      };
    },
  };
}
