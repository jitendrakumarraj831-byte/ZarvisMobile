import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicAIProvider, type AnthropicMessagesClient } from "../../src/ai/anthropicProvider.js";
import type { AIRequest } from "../../src/ai/provider.js";

const baseRequest: AIRequest = {
  systemPrompt: "You are JARVIS.",
  messages: [{ role: "user", content: "find the best phone under 20000" }],
  tools: [
    { name: "web.search", description: "Search the web", inputSchema: { requiredFields: ["query"], properties: { query: "string" } } },
  ],
  modelConfig: { provider: "anthropic", model: "claude-opus-5" },
};

function fakeMessage(overrides: Partial<Anthropic.Message>): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 } as Anthropic.Usage,
    ...overrides,
  } as Anthropic.Message;
}

describe("AnthropicAIProvider.generate", () => {
  it("returns a plain assistant message when Claude replies with text only", async () => {
    const client: AnthropicMessagesClient = {
      create: vi.fn().mockResolvedValue(
        fakeMessage({ content: [{ type: "text", text: "Hello there", citations: [] } as Anthropic.TextBlock] }),
      ),
      stream: vi.fn(),
    };
    const provider = new AnthropicAIProvider(client, "claude-opus-5");

    const result = await provider.generate(baseRequest);

    expect(result.message).toEqual({ role: "assistant", content: "Hello there" });
    expect(result.toolCalls).toEqual([]);
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it("maps a tool_use block to a ToolCallRequest", async () => {
    const client: AnthropicMessagesClient = {
      create: vi.fn().mockResolvedValue(
        fakeMessage({
          stop_reason: "tool_use",
          content: [
            { type: "tool_use", id: "toolu_1", name: "web.search", input: { query: "best phone under 20000" } } as Anthropic.ToolUseBlock,
          ],
        }),
      ),
      stream: vi.fn(),
    };
    const provider = new AnthropicAIProvider(client, "claude-opus-5");

    const result = await provider.generate(baseRequest);

    expect(result.toolCalls).toEqual([{ id: "toolu_1", skillId: "web.search", input: { query: "best phone under 20000" } }]);
  });

  it("passes the skill catalogue through as Anthropic tool definitions", async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage({ content: [] }));
    const client: AnthropicMessagesClient = { create, stream: vi.fn() };
    const provider = new AnthropicAIProvider(client, "claude-opus-5");

    await provider.generate(baseRequest);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-opus-5",
        system: "You are JARVIS.",
        tools: [
          {
            name: "web.search",
            description: "Search the web",
            input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
          },
        ],
      }),
    );
  });

  it("surfaces a refusal as an honest message instead of empty text", async () => {
    const client: AnthropicMessagesClient = {
      create: vi.fn().mockResolvedValue(fakeMessage({ stop_reason: "refusal", content: [] })),
      stream: vi.fn(),
    };
    const provider = new AnthropicAIProvider(client, "claude-opus-5");

    const result = await provider.generate(baseRequest);

    expect(result.message.content).toBe("I can't help with that request.");
  });

  it("falls back to the default model when the request omits one", async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage({ content: [] }));
    const client: AnthropicMessagesClient = { create, stream: vi.fn() };
    const provider = new AnthropicAIProvider(client, "claude-opus-5");

    await provider.generate({ ...baseRequest, modelConfig: { provider: "anthropic", model: "" } });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-opus-5" }));
  });
});

describe("AnthropicAIProvider.streamGenerate", () => {
  it("yields text deltas followed by a final done chunk", async () => {
    async function* events(): AsyncIterable<Anthropic.MessageStreamEvent> {
      yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } } as Anthropic.MessageStreamEvent;
      yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } } as Anthropic.MessageStreamEvent;
    }
    const client: AnthropicMessagesClient = { create: vi.fn(), stream: vi.fn().mockReturnValue(events()) };
    const provider = new AnthropicAIProvider(client, "claude-opus-5");

    const chunks = [];
    for await (const chunk of provider.streamGenerate(baseRequest)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { delta: "Hel", done: false },
      { delta: "lo", done: false },
      { delta: "", done: true },
    ]);
  });
});
