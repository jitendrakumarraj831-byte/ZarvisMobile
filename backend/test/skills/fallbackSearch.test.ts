import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("falls back when the primary is rate limited, and keeps the primary's error if both fail", async () => {
    const limited = { search: async () => { throw new SkillUserError("ai_rate_limited", "too many", true); } };
    const good = { search: async () => ({ answer: "ok", results: [{ title: "t", url: "https://x.test", snippet: "" }] }) };
    await expect(new FallbackSearchProvider(limited, good).search("q")).resolves.toMatchObject({ answer: "ok" });
    const bad = { search: async () => { throw new Error("down"); } };
    await expect(new FallbackSearchProvider(limited, bad).search("q")).rejects.toMatchObject({ reason: "ai_rate_limited" });
  });
});
