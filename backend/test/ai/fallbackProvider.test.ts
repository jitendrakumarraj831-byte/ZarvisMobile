import { describe, expect, it, vi, afterEach } from "vitest";
import { AIProviderError } from "../../src/ai/geminiErrors.js";
import { FallbackProvider } from "../../src/ai/fallbackProvider.js";
import { OpenRouterProvider } from "../../src/ai/openRouterProvider.js";
import type { AIProvider, AIRequest } from "../../src/ai/provider.js";

const request: AIRequest = {
  systemPrompt: "s",
  messages: [{ role: "user", content: "hi" }],
  modelConfig: { provider: "google", model: "gemini-x" },
};
const quota = () => new AIProviderError("quota", "AI_QUOTA_EXCEEDED", 429, false, undefined, "daily");
const ok = (text: string): AIProvider => ({
  id: "ok",
  generate: async () => ({ message: { role: "assistant", content: text }, toolCalls: [], usage: { promptTokens: 0, completionTokens: 0 } }),
  async *streamGenerate() { yield { delta: text, done: false }; yield { delta: "", done: true }; },
});
const failing: AIProvider = {
  id: "google",
  generate: async () => { throw quota(); },
  // eslint-disable-next-line require-yield
  async *streamGenerate() { throw quota(); },
};

describe("FallbackProvider", () => {
  it("answers from the secondary (with its own model id) when the primary fails", async () => {
    const generate = vi.fn(ok("from openrouter").generate);
    const secondary = { ...ok("x"), id: "openrouter", generate };
    const res = await new FallbackProvider(failing, secondary, "or/model").generate(request);
    expect(res.message.content).toBe("from openrouter");
    expect(generate.mock.calls[0]![0].modelConfig).toMatchObject({ provider: "openrouter", model: "or/model" });
  });

  it("streams from the secondary when the primary fails before any chunk", async () => {
    const chunks: string[] = [];
    for await (const c of new FallbackProvider(failing, ok("fb"), "m").streamGenerate(request)) chunks.push(c.delta);
    expect(chunks.join("")).toBe("fb");
  });

  it("does not fall back after the user cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const secondary = ok("no");
    const spy = vi.spyOn(secondary, "generate");
    await expect(new FallbackProvider(failing, secondary, "m").generate({ ...request, signal: controller.signal })).rejects.toBeInstanceOf(AIProviderError);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("OpenRouterProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses text and tool calls from a chat completion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "r1",
      choices: [{ message: { content: "hello", tool_calls: [{ id: "t1", function: { name: "skill.a", arguments: "{\"q\":1}" } }] } }],
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    }), { status: 200 })));
    const res = await new OpenRouterProvider("k").generate({ ...request, modelConfig: { provider: "openrouter", model: "m" } });
    expect(res.message.content).toBe("hello");
    expect(res.toolCalls).toEqual([{ id: "t1", skillId: "skill.a", input: { q: 1 } }]);
    expect(res.usage).toEqual({ promptTokens: 3, completionTokens: 4 });
  });

  it("maps 402 to a non-retryable quota error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no credits", { status: 402 })));
    await expect(new OpenRouterProvider("k").generate(request)).rejects.toMatchObject({ code: "AI_QUOTA_EXCEEDED" });
  });
});
