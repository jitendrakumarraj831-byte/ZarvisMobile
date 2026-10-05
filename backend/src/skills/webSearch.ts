import { beginModelCall } from "../ai/callTrace.js";
import { classifyGeminiFailure, providerErrorUserMessage, retryDelayMs, sleep, toProviderError } from "../ai/geminiErrors.js";
import { logger } from "../security/redact.js";
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
    const body = JSON.stringify({
      contents: [{
        parts: [{
          text:
            `Search the web for: ${query}. Return a concise answer and rely on current web sources. Do not invent sources.`,
        }],
      }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
    });
    let response: Response;
    const call = beginModelCall("search", this.model);
    for (let attempt = 0; ; attempt += 1) {
      call.httpRequests += 1;
      response = await fetchWithTimeout(
        `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
        { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey }, body },
        60_000,
      );
      if (response.ok) {
        call.servedModel = this.model;
        call.outcome = "ok";
        break;
      }
      call.status = response.status;
      const detail = await response.text().catch(() => "");
      const failure = classifyGeminiFailure(response.status, detail, response.headers.get("retry-after"));
      const wait = retryDelayMs(failure, attempt);
      if (wait !== null) {
        await sleep(wait);
        continue;
      }
      const error = toProviderError("Gemini Google Search", response.status, response.statusText, failure, detail, this.model);
      call.failure = { code: error.code, quotaType: error.quotaType, ...error.evidence };
      if (failure.kind === "quota") {
        // A quota/rate limit is a known, explainable condition: report it as such so the agent
        // loop stops instead of searching again (each retry would hit the same limit).
        throw new SkillUserError(
          error.code === "AI_QUOTA_EXCEEDED" ? "ai_quota_exceeded" : "ai_rate_limited",
          providerErrorUserMessage(error),
          error.retryable,
        );
      }
      throw error;
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

/**
 * Live web search through OpenRouter's web plugin (the `:online` model suffix). Used behind
 * Gemini (see [FallbackSearchProvider]) or alone when only OPENROUTER_API_KEY is set. Sources
 * come back as `url_citation` annotations on the assistant message.
 */
export class OpenRouterSearchProvider implements SearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = "google/gemini-2.0-flash-001",
    private readonly baseUrl = "https://openrouter.ai/api/v1",
  ) {}

  async search(query: string): Promise<SearchResponse> {
    const model = this.model.endsWith(":online") ? this.model : `${this.model}:online`;
    const call = beginModelCall("search", model);
    call.httpRequests += 1;
    const response = await fetchWithTimeout(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}`, "x-title": "ZARVIS" },
        body: JSON.stringify({
          model,
          messages: [{
            role: "user",
            content: `Search the web for: ${query}. Return a concise answer and rely on current web sources. Do not invent sources.`,
          }],
          temperature: 0.2,
          max_tokens: 1200,
        }),
      },
      60_000,
    );
    if (!response.ok) {
      call.status = response.status;
      const detail = await response.text().catch(() => "");
      call.failure = { code: "AI_UNAVAILABLE", model };
      throw new Error(`OpenRouter web search failed: ${response.status} ${detail.slice(0, 200)}`);
    }
    call.servedModel = model;
    call.outcome = "ok";
    const json = (await response.json()) as OpenRouterSearchResponse;
    const message = json.choices?.[0]?.message;
    const results: SearchResult[] = [];
    for (const annotation of message?.annotations ?? []) {
      const cite = annotation.url_citation;
      if (annotation.type !== "url_citation" || !cite?.url || results.some((result) => result.url === cite.url)) continue;
      let title = cite.title;
      if (!title) {
        try {
          title = new URL(cite.url).hostname;
        } catch {
          title = cite.url;
        }
      }
      results.push({ title, url: cite.url, snippet: (cite.content ?? "").slice(0, 300) });
      if (results.length >= 8) break;
    }
    return { answer: (message?.content ?? "").trim(), results };
  }
}

interface OpenRouterSearchResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      annotations?: Array<{ type?: string; url_citation?: { url?: string; title?: string; content?: string } }>;
    };
  }>;
}

/** Tries `primary`; on any failure answers from `secondary` so one provider's limit never ends search. */
export class FallbackSearchProvider implements SearchProvider {
  constructor(
    private readonly primary: SearchProvider,
    private readonly secondary: SearchProvider,
  ) {}

  async search(query: string): Promise<SearchResponse> {
    try {
      return await this.primary.search(query);
    } catch (primaryError) {
      logger.warn("Primary web search failed; falling back", {
        reason: primaryError instanceof Error ? primaryError.message.slice(0, 200) : "unknown",
      });
      try {
        return await this.secondary.search(query);
      } catch {
        // Report the primary's (user-explainable) error, e.g. the rate-limit message.
        throw primaryError;
      }
    }
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
