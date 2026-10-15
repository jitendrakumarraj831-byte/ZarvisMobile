import { afterEach, describe, expect, it, vi } from "vitest";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import { FallbackSearchProvider, OpenRouterSearchProvider } from "../../src/skills/webSearch.js";
import { SkillUserError } from "../../src/tooling/toolPipeline.js";

afterEach(() => vi.unstubAllGlobals());

describe("web search fallback", () => {
  it("OpenRouter search uses the :online model and maps url_citation sources", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).model).toBe("m/x:online");
      return new Response(JSON.stringify({
        choices: [{ message: { content: "answer", annotations: [
          { type: "url_citation", url_citation: { url: "https://a.test/1", title: "A", content: "snip" } },
          { type: "url_citation", url_citation: { url: "https://a.test/1", title: "dup" } },
        ] } }],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await new OpenRouterSearchProvider("k", "m/x").search("q");
    expect(res.answer).toBe("answer");
    expect(res.results).toEqual([{ title: "A", url: "https://a.test/1", snippet: "snip" }]);
  });

  const answerWith = (calls: Array<{ url: string; init: RequestInit; body: any }>) =>
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init, body: JSON.parse(init.body as string) });
      return new Response(JSON.stringify({ choices: [{ message: { content: "answer", annotations: [{ type: "url_citation", url_citation: { url: "https://a.test/1", title: "A" } }] } }] }), { status: 200 });
    });

  it("asks the web plugin explicitly for a model that already has a variant suffix (never `:free:online`)", async () => {
    const calls: Array<{ url: string; init: RequestInit; body: any }> = [];
    vi.stubGlobal("fetch", answerWith(calls));
    await new OpenRouterSearchProvider("sk-or-v1-testkey0001", "vendor/model:free").search("q");
    await new OpenRouterSearchProvider("sk-or-v1-testkey0001", "vendor/other:online").search("q");

    expect(calls[0]!.body.model).toBe("vendor/model:free");
    expect(calls[0]!.body.plugins).toEqual([{ id: "web", max_results: 5 }]);
    // A trailing :online is the shorthand for the same plugin; it is kept as the shorthand.
    expect(calls[1]!.body.model).toBe("vendor/other:online");
    expect(calls[1]!.body).not.toHaveProperty("plugins");
  });

  it("uses the configured address and data policy, the app headers, and refuses redirects", async () => {
    const calls: Array<{ url: string; init: RequestInit; body: any }> = [];
    vi.stubGlobal("fetch", answerWith(calls));
    await new OpenRouterSearchProvider("sk-or-v1-testkey0001", "m/x", { baseUrl: "https://proxy.example.com/or/v1/", dataCollection: "deny" }).search("q");

    expect(calls[0]!.url).toBe("https://proxy.example.com/or/v1/chat/completions");
    expect(calls[0]!.body.provider).toEqual({ data_collection: "deny" });
    expect(calls[0]!.init.redirect).toBe("error");
    expect(calls[0]!.init.headers).toMatchObject({ authorization: "Bearer sk-or-v1-testkey0001", "http-referer": "https://zarvismobile.com", "x-title": "ZARVIS" });
  });

  it("reports a rejected key as a structured error without echoing the key, and a spent balance as a quota the agent can explain", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: 401, message: "User not found." } }), { status: 401 })));
    const rejected = await new OpenRouterSearchProvider("sk-or-v1-testkey0001", "m/x").search("q").catch((e: unknown) => e);
    expect(rejected).toBeInstanceOf(AIProviderError);
    expect((rejected as AIProviderError).kind).toBe("AI_PROVIDER_AUTH_ERROR");
    expect((rejected as AIProviderError).message).not.toContain("sk-or-v1-testkey0001");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: 402, message: "Insufficient credits" } }), { status: 402 })));
    await expect(new OpenRouterSearchProvider("sk-or-v1-testkey0001", "m/x").search("q")).rejects.toMatchObject({ reason: "ai_quota_exceeded" });
  });

  it("refuses a key that cannot be a key before sending anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(new OpenRouterSearchProvider("sk-or-v1-abc\ndef", "m/x").search("q")).rejects.toMatchObject({ kind: "AI_PROVIDER_AUTH_ERROR" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up on an answer that never arrives", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))),
    );
    await expect(new OpenRouterSearchProvider("sk-or-v1-testkey0001", "m/x", { timeoutMs: 30 }).search("q")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("falls back when the primary is rate limited, and keeps the primary's error if both fail", async () => {
    const limited = { search: async () => { throw new SkillUserError("ai_rate_limited", "too many", true); } };
    const good = { search: async () => ({ answer: "ok", results: [{ title: "t", url: "https://x.test", snippet: "" }] }) };
    await expect(new FallbackSearchProvider(limited, good).search("q")).resolves.toMatchObject({ answer: "ok" });
    const bad = { search: async () => { throw new Error("down"); } };
    await expect(new FallbackSearchProvider(limited, bad).search("q")).rejects.toMatchObject({ reason: "ai_rate_limited" });
  });
});
