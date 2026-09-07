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

/**
 * Named heuristics for the small reference skill set — see SKILLS.md "Current catalogue".
 * The `default` branch (whole utterance verbatim) is only correct when a skill has exactly
 * one required field; a skill with two or more crams the *same* full utterance into every
 * field otherwise — caught live, twice, for `business.draft_invoice`'s `client`+`items` and
 * again for `automation.create_workflow`'s `goal`+`steps` (`automation.cancel_workflow`'s
 * `goalMatch` needs its own case for a different reason: it's a single field, but the
 * default's whole-utterance value includes the "cancel/stop" trigger words themselves,
 * which then fails to match the stored goal text at all). Add a new named case for any
 * future skill in the same shape rather than reaching for `default` again.
 */
function fillInput(tool: ToolDefinition, utterance: string): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of tool.inputSchema.requiredFields) {
    switch (field) {
      case "query":
      case "text":
      case "prompt":
      case "customerMessage":
        values[field] = utterance;
        break;
      case "repoUrl": {
        const match = utterance.match(/https?:\/\/\S+/);
        values[field] = match?.[0] ?? "https://github.com/example/demo-repo";
        break;
      }
      case "client": {
        const beforeItems = utterance.split(/\d/)[0] ?? utterance;
        const withoutTrigger = beforeItems.replace(/^.*?\b(?:invoice|bill)\b/i, "");
        values[field] = withoutTrigger.replace(/\bfor\b\s*$/i, "").trim() || utterance;
        break;
      }
      case "items": {
        const digitIndex = utterance.search(/\d/);
        values[field] = digitIndex >= 0 ? utterance.slice(digitIndex) : utterance;
        break;
      }
      case "goal":
      case "steps": {
        // "create a workflow: check email, then draft replies, then send a summary" -> both
        // fields get the text after the trigger phrase — `goal` and `steps` end up
        // identical here, which is fine: automation.create_workflow's own goal is
        // realistically just a label for the same step list in this coarse phrasing.
        const stripped = utterance.replace(/^.*?\b(?:workflow|automate|automation)\b\s*:?\s*/i, "");
        values[field] = stripped.trim() || utterance;
        break;
      }
      case "goalMatch": {
        // "cancel my check email workflow" -> "check email" — strip the cancel/stop trigger
        // and a trailing "workflow"/"task" so the match lines up with how `goal`/`steps`
        // above already stripped the *creating* utterance's own trigger phrase.
        const stripped = utterance
          .replace(/^\s*(?:please\s+)?(?:cancel|stop)\s+(?:my\s+)?/i, "")
          .replace(/\s+(?:workflow|task)\s*$/i, "");
        values[field] = stripped.trim() || utterance;
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
