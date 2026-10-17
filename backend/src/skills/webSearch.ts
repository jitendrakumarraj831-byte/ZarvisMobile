import { beginModelCall, withKeySlot } from "../ai/callTrace.js";
import { AIProviderError, classifyGeminiFailure, providerErrorUserMessage, retryDelayMs, sleep, toProviderError } from "../ai/geminiErrors.js";
import { keyFailureOf } from "../ai/keyRotatingProvider.js";
import { classifyOpenRouterFailure, toOpenRouterError } from "../ai/openRouterErrors.js";
import { NO_REDIRECTS, isUsableApiKey, openRouterHeaders, openRouterUrl, unusableKeyError } from "../ai/openRouterHttp.js";
import { DEFAULT_GROQ_BASE_URL } from "../ai/openRouterProvider.js";
import type { KeyRotator } from "../security/keyRotator.js";
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
  /** The service, for logs (`google`, `groq`, `openrouter`). */
  readonly id?: string;
  search(query: string): Promise<SearchResponse>;
}

/** What every live search provider is asked. */
function searchPrompt(query: string): string {
  return `Search the web for: ${query}. Return a concise answer and rely on current web sources. Do not invent sources.`;
}

/**
 * A spent quota or a rate limit is a known, explainable condition: it is reported as such so the agent loop
 * stops instead of searching again (each retry would hit the same limit). The provider's error stays as the
 * cause, so a caller with several keys can still tell that it was about this key.
 */
function explainable(error: AIProviderError): SkillUserError {
  const skillError = new SkillUserError(error.code === "AI_QUOTA_EXCEEDED" ? "ai_quota_exceeded" : "ai_rate_limited", providerErrorUserMessage(error), error.retryable);
  skillError.cause = error;
  return skillError;
}

/**
 * Real Google Search grounding through Gemini. Gemini performs the search and returns
 * grounding metadata containing source URLs/titles; no separate search API key is needed.
 *
 * Like chat, it asks `fallbackModels` (`GEMINI_FALLBACK_MODELS`) after the configured model: Google counts the
 * free-tier allowance per model, so when one model is rate limited or out of quota, or does not exist, the next
 * one may still search. With another model left, a limited model is not waited for.
 */
export class GeminiSearchProvider implements SearchProvider {
  readonly id = "google";

  constructor(
    private readonly apiKey: string,
    private readonly model = "gemini-3.6-flash",
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta",
    private readonly fallbackModels: readonly string[] = [],
  ) {}

  async search(query: string): Promise<SearchResponse> {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: searchPrompt(query) }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
    });
    const models = [this.model, ...this.fallbackModels].filter((model, index, all) => all.indexOf(model) === index);
    const call = beginModelCall("search", this.model, undefined, "google");
    let response: Response | undefined;
    let last: { error: AIProviderError; quota: boolean } | undefined;
    for (const [index, model] of models.entries()) {
      const hasNext = index < models.length - 1;
      for (let attempt = 0; ; attempt += 1) {
        call.httpRequests += 1;
        const answer = await fetchWithTimeout(
          `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
          { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey }, body },
          60_000,
        );
        if (answer.ok) {
          response = answer;
          call.servedModel = model;
          call.outcome = "ok";
          break;
        }
        call.status = answer.status;
        const detail = await answer.text().catch(() => "");
        const failure = classifyGeminiFailure(answer.status, detail, answer.headers.get("retry-after"));
        const error = toProviderError("Gemini Google Search", answer.status, answer.statusText, failure, detail, model);
        // A model that does not exist says nothing about why the one before it failed, so it does not replace that reason.
        if (failure.kind !== "not_found" || !last) {
          last = { error, quota: failure.kind === "quota" };
          call.failure = { code: error.code, quotaType: error.quotaType, ...error.evidence };
        }
        if (failure.kind === "fatal") throw error;
        const wait = failure.kind === "quota" && hasNext ? null : retryDelayMs(failure, attempt);
        if (wait === null) break;
        await sleep(wait);
      }
      if (response) break;
    }
    if (!response) throw last!.quota ? explainable(last!.error) : last!.error;
    if (call.servedModel !== this.model) logger.warn("Gemini search answered with a fallback model", { configuredModel: this.model, servedModel: call.servedModel });

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

/** Extra settings for {@link OpenRouterSearchProvider}; all optional. */
export interface OpenRouterSearchOptions {
  /** The OpenRouter API base URL (validated by the AI configuration); default: OpenRouter's own. */
  baseUrl?: string;
  /** Sent as `provider.data_collection`, like for chat: the query is user text. */
  dataCollection?: "allow" | "deny";
  timeoutMs?: number;
}

const SEARCH_RESULT_LIMIT = 8;

/**
 * Live web search through OpenRouter's web plugin. Used last, behind Gemini and Groq (see [FallbackSearchProvider]),
 * because OpenRouter bills the plugin per search, or alone when only OpenRouter has a key. Sources come back as
 * `url_citation` annotations on the assistant message.
 *
 * A plain model id gets the documented `:online` shorthand. A model that already carries a variant
 * suffix (`vendor/model:free`) cannot take a second one, so the same plugin is requested explicitly
 * (`plugins: [{ id: "web" }]`). It goes through the same address, headers, key check, redirect refusal
 * and error classification as chat (`ai/openRouterHttp.ts`, `ai/openRouterErrors.ts`).
 */
export class OpenRouterSearchProvider implements SearchProvider {
  readonly id = "openrouter";
  private readonly options: OpenRouterSearchOptions;

  constructor(
    private readonly apiKey: string,
    private readonly model = "google/gemini-2.0-flash-001",
    options: OpenRouterSearchOptions | string = {},
  ) {
    this.options = typeof options === "string" ? { baseUrl: options } : options;
  }

  async search(query: string): Promise<SearchResponse> {
    if (!isUsableApiKey(this.apiKey)) throw unusableKeyError("openrouter");
    const base = this.model.replace(/:online$/, "");
    const hasVariant = /:[A-Za-z0-9_-]+$/.test(base);
    const model = hasVariant ? base : `${base}:online`;
    const call = beginModelCall("search", model, undefined, "openrouter");
    call.httpRequests += 1;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 60_000);
    try {
      const response = await fetch(openRouterUrl(this.options.baseUrl, "chat/completions"), {
        method: "POST",
        headers: openRouterHeaders(this.apiKey, { "content-type": "application/json" }),
        body: JSON.stringify({
          model,
          ...(hasVariant ? { plugins: [{ id: "web", max_results: 5 }] } : {}),
          messages: [{ role: "user", content: searchPrompt(query) }],
          temperature: 0.2,
          max_tokens: 1200,
          ...(this.options.dataCollection ? { provider: { data_collection: this.options.dataCollection } } : {}),
        }),
        signal: controller.signal,
        ...NO_REDIRECTS,
      });
      if (!response.ok) {
        call.status = response.status;
        const detail = await response.text().catch(() => "");
        const failure = classifyOpenRouterFailure(response.status, detail, response.headers.get("retry-after"));
        const error = toOpenRouterError("OpenRouter web search", response.status, response.statusText, failure, detail, model);
        call.failure = { code: error.code, quotaType: error.quotaType, ...error.evidence };
        // A spent quota or an empty balance is explainable: report it so the agent loop does not search again.
        throw failure.kind === "quota" ? explainable(error) : error;
      }
      const json = (await response.json()) as OpenRouterSearchResponse;
      call.servedModel = model;
      call.outcome = "ok";
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
        if (results.length >= SEARCH_RESULT_LIMIT) break;
      }
      return { answer: (message?.content ?? "").trim(), results };
    } finally {
      clearTimeout(timer);
    }
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

/** Groq searches only with its GPT-OSS models (the built-in `browser_search` tool). */
export const DEFAULT_GROQ_SEARCH_MODEL = "openai/gpt-oss-120b";

/** Extra settings for {@link GroqSearchProvider}; all optional. */
export interface GroqSearchOptions {
  /** Groq's OpenAI-compatible base URL, validated like GROQ_BASE_URL for chat; default: Groq's own. */
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Live web search through Groq: a GPT-OSS model with Groq's built-in `browser_search` tool, which runs on Groq's
 * side. `tool_choice: "required"` makes the model search instead of answering from memory. The sources are what
 * the tool returned (`executed_tools[].search_results.results`, and the pages it opened, `browser_results`), never
 * links the model wrote into its answer. Same plain OpenAI-compatible request, key check, redirect refusal and
 * error classification as Groq chat.
 */
export class GroqSearchProvider implements SearchProvider {
  readonly id = "groq";

  constructor(
    private readonly apiKey: string,
    private readonly model = DEFAULT_GROQ_SEARCH_MODEL,
    private readonly options: GroqSearchOptions = {},
  ) {}

  async search(query: string): Promise<SearchResponse> {
    if (!isUsableApiKey(this.apiKey)) throw unusableKeyError("groq", "Groq");
    const call = beginModelCall("search", this.model, undefined, "groq");
    call.httpRequests += 1;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 60_000);
    try {
      const response = await fetch(openRouterUrl(this.options.baseUrl ?? DEFAULT_GROQ_BASE_URL, "chat/completions"), {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: searchPrompt(query) }],
          tools: [{ type: "browser_search" }],
          tool_choice: "required",
          temperature: 0.2,
          // The model reasons before it answers, and the reasoning counts against this limit too.
          max_tokens: 2048,
        }),
        signal: controller.signal,
        ...NO_REDIRECTS,
      });
      if (!response.ok) {
        call.status = response.status;
        const detail = await response.text().catch(() => "");
        const failure = classifyOpenRouterFailure(response.status, detail, response.headers.get("retry-after"));
        const error = toOpenRouterError("Groq web search", response.status, response.statusText, failure, detail, this.model, "groq");
        call.failure = { code: error.code, quotaType: error.quotaType, ...error.evidence };
        throw failure.kind === "quota" ? explainable(error) : error;
      }
      const json = (await response.json()) as GroqSearchResponse;
      call.servedModel = this.model;
      call.outcome = "ok";
      const message = json.choices?.[0]?.message;
      const tools = message?.executed_tools ?? [];
      const results: SearchResult[] = [];
      const add = (url: string | undefined, title: string | undefined, content: string | undefined) => {
        if (!url || !isWebUrl(url) || results.length >= SEARCH_RESULT_LIMIT || results.some((result) => result.url === url)) return;
        results.push({ title: title?.trim() || new URL(url).hostname, url, snippet: (content ?? "").slice(0, 300) });
      };
      for (const tool of tools) {
        for (const result of tool.search_results?.results ?? []) add(result.url, result.title, result.content);
        for (const page of tool.browser_results ?? []) add(page.url, page.title, page.content);
      }
      if (results.length === 0) {
        // Which tools ran and which fields they returned (never their content): a changed answer shape shows in the log.
        logger.warn("Groq web search returned no sources", {
          tools: tools.slice(0, 5).map((tool) => tool.type ?? "unknown"),
          fields: [...new Set(tools.flatMap((tool) => Object.keys(tool)))].slice(0, 12),
        });
      }
      return { answer: (message?.content ?? "").trim(), results };
    } finally {
      clearTimeout(timer);
    }
  }
}

interface GroqSearchResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      executed_tools?: Array<{
        type?: string;
        search_results?: { results?: Array<{ title?: string; url?: string; content?: string }> };
        browser_results?: Array<{ title?: string; url?: string; content?: string }>;
      }>;
    };
  }>;
}

function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * One search service with several API keys (`GEMINI_KEYS=k1,k2`): when the service refuses the active key for a
 * reason that is about that key (a rate limit, a spent quota, a rejected key), the key rests and the same search
 * goes out at once with the next one, as chat does (ai/keyRotatingProvider.ts). Any other failure is the same
 * for every key and leaves at once, so the next search provider answers.
 */
export class KeyRotatingSearchProvider implements SearchProvider {
  constructor(
    readonly id: string,
    private readonly rotator: KeyRotator,
    private readonly build: (key: string) => SearchProvider,
  ) {}

  async search(query: string): Promise<SearchResponse> {
    const leases = this.rotator.plan();
    if (leases.length === 0) throw new UnavailableSearchProvider().unavailable();
    let last: unknown;
    for (const lease of leases) {
      const provider = this.build(lease.key);
      try {
        const response = await (lease.total > 1 ? withKeySlot(lease.slot, () => provider.search(query)) : provider.search(query));
        this.rotator.reportSuccess(lease);
        return response;
      } catch (error) {
        const failure = keyFailureOf(error instanceof SkillUserError ? error.cause : error);
        if (!failure) throw error;
        this.rotator.reportFailure(lease, failure.reason, failure.retryAfterMs);
        last = error;
      }
    }
    throw last;
  }
}

/** For logs: the provider's own (redacted) error behind an explainable one, which only says "too many requests". */
function reasonOf(error: unknown): string {
  const cause = error instanceof SkillUserError && error.cause instanceof Error ? error.cause : error;
  return cause instanceof Error ? cause.message.slice(0, 200) : "unknown";
}

/**
 * Asks the providers in order and returns the first answer that has sources. A provider that fails (its limit, an
 * outage, a refused key) or finds no sources hands the search to the next one, so one provider never ends search.
 * When none found sources, an answer without them is returned if there was one (the skill then says nothing
 * sourced was found); when every provider failed, the first explainable error (a rate limit or a spent quota the
 * agent can put into words), else the first error.
 */
export class FallbackSearchProvider implements SearchProvider {
  private readonly providers: SearchProvider[];

  constructor(primary: SearchProvider, ...fallbacks: SearchProvider[]) {
    this.providers = [primary, ...fallbacks];
  }

  async search(query: string): Promise<SearchResponse> {
    const errors: unknown[] = [];
    let unsourced: SearchResponse | undefined;
    for (const [index, provider] of this.providers.entries()) {
      const next = this.providers[index + 1];
      try {
        const response = await provider.search(query);
        if (response.results.length > 0) return response;
        unsourced ??= response;
        if (next) logger.warn("Web search found no sources; trying the next provider", { provider: provider.id, next: next.id });
      } catch (error) {
        errors.push(error);
        if (next) logger.warn("Web search failed; trying the next provider", { provider: provider.id, next: next.id, reason: reasonOf(error) });
      }
    }
    if (unsourced) return unsourced;
    // Every provider failed: one line with each one's reason, so the log says why search did not run.
    logger.warn("Web search failed on every provider", {
      failures: this.providers.map((provider, index) => ({ provider: provider.id, reason: reasonOf(errors[index]) })),
    });
    throw errors.find((error) => error instanceof SkillUserError) ?? errors[0];
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
    throw this.unavailable();
  }

  unavailable(): SkillUserError {
    return new SkillUserError(
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
