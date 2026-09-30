import { SkillUserError } from "../tooling/toolPipeline.js";
import type { SkillDefinition } from "../domain/types.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  /** The provider's grounded answer text (empty when the provider returns only links). */
  answer: string;
  results: SearchResult[];
}

export interface SearchProvider {
  search(query: string): Promise<SearchResponse>;
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

  async search(query: string): Promise<SearchResponse> {
    const response = await fetchWithTimeout(
      `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
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
      60_000,
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
        snippet: "",
      });
      if (results.length >= 8) break;
    }
    return { answer, results };
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
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
  async search(query: string): Promise<SearchResponse> {
    return {
      answer: `[Mock search — no live provider configured] No real answer for "${query}".`,
      results: [
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
      ],
    };
  }
}

/** Production without a live search provider: fail honestly, never return placeholder results. */
export class UnavailableSearchProvider implements SearchProvider {
  async search(): Promise<SearchResponse> {
    throw new SkillUserError(
      "search_provider_unavailable",
      "Web search isn't available right now: no search provider is configured on this server. Nothing was searched or charged.",
    );
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
    actionClass: "READ_ONLY",
    requiresConfirmation: false,
    executesOnDevice: false,
    inputSchema: { requiredFields: ["query"], properties: { query: "string" } },
    handler: async (input) => {
      const query = String(input.values.query ?? "").trim();
      if (!query) {
        return { kind: "failure", reason: "missing_query", userMessage: "What would you like me to search for?" };
      }
      const { answer, results } = await provider.search(query);
      if (results.length === 0) {
        // No grounding sources means the answer can't be attributed — never present it as sourced.
        return { kind: "failure", reason: "no_results", userMessage: `I couldn't find sourced web results for "${query}".` };
      }
      const sources = results.slice(0, 5).map((result, index) => `[${index + 1}] ${result.title} — ${result.url}`).join("\n");
      return {
        kind: "success",
        output: { query, answer, results },
        // The model receives the grounded answer AND its sources, so its reply can be based
        // on what the search actually returned instead of guessing from titles alone.
        summary: `${answer.trim() || "(The search returned sources but no summary text.)"}\n\nSources:\n${sources}`,
      };
    },
  };
}
