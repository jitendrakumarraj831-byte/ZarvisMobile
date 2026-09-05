import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "../../src/ai/geminiProvider.js";
import type { AIRequest } from "../../src/ai/provider.js";

const baseRequest: AIRequest = {
  systemPrompt: "You are ZARVIS.",
  messages: [{ role: "user", content: "find the best phone under 20000" }],
  tools: [
    {
      name: "web.search",
      description: "Search the web",
      inputSchema: { requiredFields: ["query"], properties: { query: "string" } },
    },
  ],
  modelConfig: { provider: "google", model: "gemini-2.0-flash" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GeminiProvider.generate", () => {
  it("sends a well-formed request and maps a text response", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain("models/gemini-2.0-flash:generateContent");
      expect(url).toContain("key=test-key");
      const body = JSON.parse(init.body as string);
      expect(body.systemInstruction.parts[0].text).toBe("You are ZARVIS.");
      expect(body.contents).toEqual([{ role: "user", parts: [{ text: "find the best phone under 20000" }] }]);
      expect(body.tools[0].functionDeclarations[0]).toEqual({
        name: "web.search",
        description: "Search the web",
        parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] },
      });
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Here you go" }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiProvider("test-key");
    const response = await provider.generate(baseRequest);

    expect(response.message).toEqual({ role: "assistant", content: "Here you go" });
    expect(response.toolCalls).toEqual([]);
    expect(response.usage).toEqual({ promptTokens: 10, completionTokens: 4 });
  });

  it("maps a functionCall part to a tool call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ functionCall: { name: "web.search", args: { query: "best phone" } } }] } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const provider = new GeminiProvider("test-key");
    const response = await provider.generate(baseRequest);

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0]).toMatchObject({ skillId: "web.search", input: { query: "best phone" } });
  });

  it("throws with an honest error on a non-2xx response — never fakes success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad request", { status: 400, statusText: "Bad Request" })),
    );

    const provider = new GeminiProvider("test-key");
    await expect(provider.generate(baseRequest)).rejects.toThrow(/Gemini generateContent failed: 400/);
  });
});

describe("GeminiProvider.streamGenerate", () => {
  it("yields incremental text deltas parsed from the SSE stream", async () => {
    const sse =
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hello " }] } }] })}\n\n` +
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "world" }] } }] })}\n\n`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream, { status: 200 })),
    );

    const provider = new GeminiProvider("test-key");
    const chunks = [];
    for await (const chunk of provider.streamGenerate(baseRequest)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { delta: "Hello ", done: false },
      { delta: "world", done: false },
      { delta: "", done: true },
    ]);
  });
});
