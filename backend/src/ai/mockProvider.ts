import { randomUUID } from "node:crypto";
import type { AIProvider, AIRequest, AIResponse, AIResponseChunk, ToolDefinition } from "./provider.js";

/**
 * Deterministic, zero-credential default provider — see AI_ARCHITECTURE.md "Provider
 * abstraction". Lets the whole tool-calling loop and the Orchestrator run and be
 * demoed/tested with no external AI credential. It picks the best-matching tool by naive
 * keyword scoring against the description (the same shape a real LLM tool-selection prompt
 * would use, deliberately simple here) and fills required input fields with a small set of
 * named heuristics — this is a stand-in, not a general NLU system.
 */
export class MockAIProvider implements AIProvider {
  readonly id = "mock";

  async generate(request: AIRequest): Promise<AIResponse> {
    const utterance = lastUserMessage(request);
    const tool = selectTool(utterance, request.tools ?? []);

    if (!tool) {
      return {
        message: {
          role: "assistant",
          content: "I'm not sure which skill can help with that yet — could you rephrase, or ask \"what can you do?\"",
        },
        toolCalls: [],
        usage: { promptTokens: estimateTokens(request), completionTokens: 12 },
      };
    }

    const input = fillInput(tool, utterance);
    return {
      message: { role: "assistant", content: "" },
      toolCalls: [{ id: randomUUID(), skillId: tool.name, input }],
      usage: { promptTokens: estimateTokens(request), completionTokens: 8 },
    };
  }

  async *streamGenerate(request: AIRequest): AsyncIterable<AIResponseChunk> {
    const response = await this.generate(request);
    const text = response.message.content || "Working on it...";
    for (const word of text.split(" ")) {
      yield { delta: `${word} `, done: false };
    }
    yield { delta: "", done: true };
  }
}

function lastUserMessage(request: AIRequest): string {
  return [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
}

function selectTool(utterance: string, tools: ToolDefinition[]): ToolDefinition | undefined {
  const normalized = utterance.toLowerCase();
  let best: { tool: ToolDefinition; score: number } | undefined;
  for (const tool of tools) {
    const words = tool.description.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const score = words.filter((word) => normalized.includes(word)).length;
    if (score > 0 && (!best || score > best.score)) {
      best = { tool, score };
    }
  }
  return best?.tool;
}

/** Named heuristics for the small reference skill set — see SKILLS.md "Current catalogue". */
function fillInput(tool: ToolDefinition, utterance: string): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of tool.inputSchema.requiredFields) {
    switch (field) {
      case "query":
      case "text":
        values[field] = utterance;
        break;
      case "repoUrl": {
        const match = utterance.match(/https?:\/\/\S+/);
        values[field] = match?.[0] ?? "https://github.com/example/demo-repo";
        break;
      }
      default:
        values[field] = utterance;
    }
  }
  return values;
}

function estimateTokens(request: AIRequest): number {
  const chars = request.systemPrompt.length + request.messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(chars / 4);
}
