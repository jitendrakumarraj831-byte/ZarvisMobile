import { afterEach, describe, expect, it, vi } from "vitest";
import { OmniRouteProvider } from "../../src/ai/omniRouteProvider.js";
import type { AIRequest } from "../../src/ai/provider.js";

const request: AIRequest = {
  systemPrompt: "You are ZARVIS.",
  messages: [{ role: "user", content: "hello" }],
  modelConfig: { provider: "omniroute", model: "auto" },
};

afterEach(() => vi.unstubAllGlobals());

describe("OmniRouteProvider", () => {
  it("maps OpenAI-compatible chat completions", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("http://omni.test/v1/chat/completions");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("auto");
      expect(body.messages[0]).toEqual({ role: "system", content: "You are ZARVIS." });
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Hello from OmniRoute" } }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OmniRouteProvider("test-key", "auto", "http://omni.test/v1");
    await expect(provider.generate(request)).resolves.toEqual({
      message: { role: "assistant", content: "Hello from OmniRoute" },
      toolCalls: [],
      usage: { promptTokens: 7, completionTokens: 3 },
    });
  });

  it("maps function tool calls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: {
        content: "",
        tool_calls: [{ id: "call-1", function: { name: "web.search", arguments: "{\"query\":\"zarvis\"}" } }],
      } }],
    }), { status: 200 })));

    const provider = new OmniRouteProvider("test-key", "auto", "http://omni.test/v1");
    const result = await provider.generate({
      ...request,
      tools: [{ name: "web.search", description: "Search", inputSchema: { requiredFields: ["query"], properties: { query: "string" } } }],
    });
    expect(result.toolCalls).toEqual([{ id: "call-1", skillId: "web.search", input: { query: "zarvis" } }]);
  });

  it("keeps upstream errors visible to the resilience layer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 503, statusText: "Service Unavailable" })));
    const provider = new OmniRouteProvider("test-key", "auto", "http://omni.test/v1");
    await expect(provider.generate(request)).rejects.toThrow(/OmniRoute chat completion failed: 503/);
  });
});
