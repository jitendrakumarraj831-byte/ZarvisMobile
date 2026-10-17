import { afterEach, describe, expect, it, vi } from "vitest";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import { KeyRotator } from "../../src/security/keyRotator.js";
import { searchProvider, type SearchProviderSettings } from "../../src/skills/index.js";
import {
  DEFAULT_GROQ_SEARCH_MODEL,
  FallbackSearchProvider,
  GeminiSearchProvider,
  GroqSearchProvider,
  KeyRotatingSearchProvider,
  type SearchProvider,
} from "../../src/skills/webSearch.js";
import { SkillUserError } from "../../src/tooling/toolPipeline.js";
import { DAILY, quotaBody } from "../ai/geminiFixtures.js";

/**
 * Web search with several keys and several services: every key of a service is used in turn (not only the first),
 * Groq's browser search answers when Gemini cannot, and a service that finds no sources hands the search on.
 */

afterEach(() => vi.unstubAllGlobals());

const GROQ_KEY = "gsk_testkeySEARCH0001aaaabbbbcccc";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

interface Call {
  url: string;
  init: RequestInit;
  body: any;
}

function recordFetch(respond: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const call = { url, init, body: JSON.parse(init.body as string) };
      calls.push(call);
      return respond(call);
    }),
  );
  return calls;
}

const groqAnswer = (executedTools: unknown[], content = "Groq answer") => json({ choices: [{ message: { role: "assistant", content, executed_tools: executedTools } }] });
const geminiAnswer = (uri: string) =>
  json({ candidates: [{ content: { parts: [{ text: "Gemini answer" }] }, groundingMetadata: { groundingChunks: [{ web: { uri, title: "G" } }] } }] });

describe("Groq browser search", () => {
  it("asks a GPT-OSS model to search with the browser_search tool, as a plain OpenAI-compatible request", async () => {
    const calls = recordFetch(() => groqAnswer([]));
    await new GroqSearchProvider(GROQ_KEY).search("best phone under 20000");

    expect(calls[0]!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(calls[0]!.body).toMatchObject({ model: DEFAULT_GROQ_SEARCH_MODEL, tools: [{ type: "browser_search" }], tool_choice: "required" });
    expect(calls[0]!.body.messages[0].content).toContain("best phone under 20000");
    expect(calls[0]!.init.headers).toEqual({ authorization: `Bearer ${GROQ_KEY}`, "content-type": "application/json" });
    expect(calls[0]!.init.redirect).toBe("error");
  });

  it("takes its sources from what the tool returned, never from links in the model's answer", async () => {
    recordFetch(() =>
      groqAnswer(
        [
          {
            type: "search",
            search_results: {
              results: [
                { title: "Phone A review", url: "https://a.test/review", content: "A long snippet", score: 0.9 },
                { title: "duplicate", url: "https://a.test/review" },
                { title: "not a web page", url: "javascript:alert(1)" },
              ],
            },
          },
          { type: "visit", browser_results: [{ title: "", url: "https://b.test/page", content: "page text" }] },
        ],
        "See https://invented.test for more.",
      ),
    );
    const response = await new GroqSearchProvider(GROQ_KEY).search("q");

    expect(response.answer).toBe("See https://invented.test for more.");
    expect(response.results).toEqual([
      { title: "Phone A review", url: "https://a.test/review", snippet: "A long snippet" },
      { title: "b.test", url: "https://b.test/page", snippet: "page text" },
    ]);
  });

  it("returns no sources (and says so in the log) when the tool returned none", async () => {
    recordFetch(() => groqAnswer([{ type: "search", output: "raw text" }]));
    await expect(new GroqSearchProvider(GROQ_KEY).search("q")).resolves.toEqual({ answer: "Groq answer", results: [] });
  });

  it("uses the configured address and a GPT-OSS model it is given", async () => {
    const calls = recordFetch(() => groqAnswer([]));
    await new GroqSearchProvider(GROQ_KEY, "openai/gpt-oss-20b", { baseUrl: "https://proxy.example.com/groq/v1" }).search("q");
    expect(calls[0]!.url).toBe("https://proxy.example.com/groq/v1/chat/completions");
    expect(calls[0]!.body.model).toBe("openai/gpt-oss-20b");
  });

  it("reports a spent daily limit as a quota the agent can explain, and a refused key as the key's problem", async () => {
    recordFetch(() => json({ error: { message: "Rate limit reached for model `openai/gpt-oss-120b` on requests per day (RPD): Limit 1000, Used 1000", type: "requests", code: "rate_limit_exceeded" } }, 429));
    const quota = await new GroqSearchProvider(GROQ_KEY).search("q").catch((error: unknown) => error);
    expect(quota).toBeInstanceOf(SkillUserError);
    expect((quota as SkillUserError).reason).toBe("ai_quota_exceeded");
    expect((quota as SkillUserError).cause).toBeInstanceOf(AIProviderError);

    recordFetch(() => json({ error: { message: "Invalid API Key", type: "invalid_request_error", code: "invalid_api_key" } }, 401));
    const rejected = await new GroqSearchProvider(GROQ_KEY).search("q").catch((error: unknown) => error);
    expect(rejected).toMatchObject({ kind: "AI_PROVIDER_AUTH_ERROR" });
    expect((rejected as Error).message).not.toContain(GROQ_KEY);
  });
});

describe("Gemini search and its fallback models", () => {
  const modelOf = (call: Call) => /models\/([^:]+):generateContent/.exec(call.url)?.[1];

  it("asks the next model at once when the configured model's quota is spent, as chat does", async () => {
    const calls = recordFetch((call) => (modelOf(call) === "gemini-3.6-flash" ? new Response(quotaBody(DAILY), { status: 429 }) : geminiAnswer("https://g.test/2")));
    const response = await new GeminiSearchProvider("gemini-key", "gemini-3.6-flash", undefined, ["gemini-3.8-flash"]).search("q");
    expect(response.results).toEqual([{ title: "G", url: "https://g.test/2", snippet: "" }]);
    expect(calls.map(modelOf)).toEqual(["gemini-3.6-flash", "gemini-3.8-flash"]);
  });

  it("reports the quota when every model is out of it, even when a fallback model does not exist", async () => {
    recordFetch((call) => (modelOf(call) === "gemini-3.6-flash" ? new Response(quotaBody(DAILY), { status: 429 }) : json({ error: { code: 404, message: "not found" } }, 404)));
    const error = await new GeminiSearchProvider("gemini-key", "gemini-3.6-flash", undefined, ["gemini-gone"]).search("q").catch((e: unknown) => e);
    expect(error).toMatchObject({ reason: "ai_quota_exceeded" });
  });

  it("gets GEMINI_FALLBACK_MODELS (default gemini-3.8-flash) from the deployment's settings", async () => {
    const calls = recordFetch((call) => (modelOf(call) === "gemini-3.6-flash" ? new Response(quotaBody(DAILY), { status: 429 }) : geminiAnswer("https://g.test/3")));
    await searchProvider({ geminiModel: "gemini-3.6-flash", geminiApiKey: "gemini-key", isProduction: true }).search("q");
    await searchProvider({ geminiModel: "gemini-3.6-flash", geminiApiKey: "gemini-key", geminiFallbackModels: "gemini-3.5-flash-lite", isProduction: true }).search("q");
    expect(calls.map(modelOf)).toEqual(["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]);
    expect(() => searchProvider({ geminiModel: "gemini-3.6-flash", geminiApiKey: "k", geminiFallbackModels: "bad model!", isProduction: true })).toThrow(/GEMINI_FALLBACK_MODELS/);
  });
});

describe("several keys for one search service", () => {
  it("searches with the next Gemini key when the first one's daily quota is spent, and starts with it next time", async () => {
    const calls = recordFetch((call) => {
      const key = (call.init.headers as Record<string, string>)["x-goog-api-key"];
      return key === "gemini-key-1" ? new Response(quotaBody(DAILY), { status: 429 }) : geminiAnswer("https://g.test/1");
    });
    const provider = searchProvider({ geminiModel: "gemini-3.6-flash", geminiKeys: ["gemini-key-1", "gemini-key-2"], isProduction: true });
    expect(provider).toBeInstanceOf(KeyRotatingSearchProvider);

    await expect(provider.search("q")).resolves.toMatchObject({ results: [{ url: "https://g.test/1" }] });
    await provider.search("q again");
    const keysUsed = calls.map((call) => (call.init.headers as Record<string, string>)["x-goog-api-key"]);
    // Key 1 is asked with the configured model and the fallback model (each has its own quota), then key 2 answers.
    expect(keysUsed).toEqual(["gemini-key-1", "gemini-key-1", "gemini-key-2", "gemini-key-2"]);
  });

  it("does not try another key for a failure that is not about the key", async () => {
    const tried: string[] = [];
    const build = (key: string): SearchProvider => ({
      search: async () => {
        tried.push(key);
        throw new AIProviderError("Gemini Google Search failed: 500", "AI_UNAVAILABLE", 503, true);
      },
    });
    const provider = new KeyRotatingSearchProvider("google", new KeyRotator({ name: "TEST", keys: () => ["k1", "k2"] }), build);
    await expect(provider.search("q")).rejects.toBeInstanceOf(AIProviderError);
    expect(tried).toEqual(["k1"]);
  });
});

describe("the search chain", () => {
  const sourced = (url: string): SearchProvider => ({ search: async () => ({ answer: url, results: [{ title: url, url, snippet: "" }] }) });
  const unsourced: SearchProvider = { search: async () => ({ answer: "no sources", results: [] }) };

  it("hands a search that found no sources to the next provider", async () => {
    await expect(new FallbackSearchProvider(unsourced, sourced("https://second.test")).search("q")).resolves.toMatchObject({ answer: "https://second.test" });
  });

  it("returns an answer without sources only when no provider found any", async () => {
    const failing: SearchProvider = { search: async () => { throw new Error("down"); } };
    await expect(new FallbackSearchProvider(failing, unsourced).search("q")).resolves.toEqual({ answer: "no sources", results: [] });
  });

  it("reports the error the agent can explain when every provider failed, whichever provider it came from", async () => {
    const down: SearchProvider = { search: async () => { throw new Error("down"); } };
    const limited: SearchProvider = { search: async () => { throw new SkillUserError("ai_rate_limited", "too many", true); } };
    await expect(new FallbackSearchProvider(down, limited, down).search("q")).rejects.toMatchObject({ reason: "ai_rate_limited" });
  });

  it("asks Gemini, then Groq: Groq answers when Gemini's quota is spent", async () => {
    const calls = recordFetch((call) =>
      call.url.includes("generativelanguage") ? new Response(quotaBody(DAILY), { status: 429 }) : groqAnswer([{ type: "search", search_results: { results: [{ title: "T", url: "https://t.test" }] } }]),
    );
    const provider = searchProvider({ geminiModel: "gemini-3.6-flash", geminiApiKey: "gemini-key", groqApiKey: GROQ_KEY, isProduction: true });
    await expect(provider.search("q")).resolves.toMatchObject({ answer: "Groq answer", results: [{ url: "https://t.test" }] });
    // Both Gemini models (the configured one and gemini-3.8-flash) before Groq.
    expect(calls.map((call) => new URL(call.url).hostname)).toEqual(["generativelanguage.googleapis.com", "generativelanguage.googleapis.com", "api.groq.com"]);
  });
});

describe("which services search", () => {
  const base: SearchProviderSettings = { geminiModel: "gemini-3.6-flash", isProduction: true };

  it("Groq alone when only Groq has a key, with GROQ_MODEL only when it is a GPT-OSS model", async () => {
    expect(searchProvider({ ...base, groqApiKey: GROQ_KEY })).toBeInstanceOf(GroqSearchProvider);

    const calls = recordFetch(() => groqAnswer([]));
    await searchProvider({ ...base, groqApiKey: GROQ_KEY, groqModel: "openai/gpt-oss-20b" }).search("q");
    await searchProvider({ ...base, groqApiKey: GROQ_KEY, groqModel: "llama-3.3-70b-versatile" }).search("q");
    expect(calls.map((call) => call.body.model)).toEqual(["openai/gpt-oss-20b", DEFAULT_GROQ_SEARCH_MODEL]);
  });

  it("every key of a service, from the list and the single-key variable", () => {
    expect(searchProvider({ ...base, groqKeys: [GROQ_KEY, "gsk_other"] })).toBeInstanceOf(KeyRotatingSearchProvider);
    expect(searchProvider({ ...base, geminiKeys: ["g1"], geminiApiKey: "g1" })).toBeInstanceOf(GeminiSearchProvider);
  });

  it("keeps a query away from Groq when the gateway's chain leaves Groq out, unless it is the only search service", () => {
    expect(searchProvider({ ...base, geminiApiKey: "g", groqApiKey: GROQ_KEY })).toBeInstanceOf(FallbackSearchProvider);
    // Unset AI_PRIMARY_PROVIDER means Groq is the primary: always allowed.
    expect(searchProvider({ ...base, geminiApiKey: "g", groqApiKey: GROQ_KEY, aiFallbackProvider: "none" })).toBeInstanceOf(FallbackSearchProvider);
    expect(searchProvider({ ...base, geminiApiKey: "g", groqApiKey: GROQ_KEY, aiPrimaryProvider: "gemini", aiFallbackProvider: "none" })).toBeInstanceOf(GeminiSearchProvider);
    expect(searchProvider({ ...base, geminiApiKey: "g", groqApiKey: GROQ_KEY, aiPrimaryProvider: "gemini", aiFallbackProvider: "openrouter, groq" })).toBeInstanceOf(FallbackSearchProvider);
    expect(searchProvider({ ...base, groqApiKey: GROQ_KEY, aiPrimaryProvider: "gemini", aiFallbackProvider: "none" })).toBeInstanceOf(GroqSearchProvider);
  });

  it("refuses an invalid GROQ_BASE_URL the way startup does", () => {
    expect(() => searchProvider({ ...base, groqApiKey: GROQ_KEY, groqBaseUrl: "http://groq.example.com/v1" })).toThrow(/GROQ_BASE_URL must use https/);
  });
});
