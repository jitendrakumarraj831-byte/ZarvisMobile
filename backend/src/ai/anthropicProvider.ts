import type Anthropic from "@anthropic-ai/sdk";
import type {
  AIProvider,
  AIRequest,
  AIResponse,
  AIResponseChunk,
  ConversationMessage,
  ToolCallRequest,
  ToolDefinition,
} from "./provider.js";

/**
 * The slice of the Anthropic SDK's `messages` resource this provider needs — narrow on
 * purpose so tests can pass a fake instead of a real `Anthropic` client (same pattern as
 * `SearchProvider`/`GitHubClient`; see AI_ARCHITECTURE.md). A real `new Anthropic().messages`
 * satisfies this structurally.
 */
export interface AnthropicMessagesClient {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  stream(params: Anthropic.MessageCreateParamsNonStreaming): AsyncIterable<Anthropic.MessageStreamEvent>;
}

/**
 * Real Claude-backed [AIProvider] — see AI_ARCHITECTURE.md "Provider abstraction". Talks to
 * the Anthropic Messages API server-side only (never bundled in the mobile app, see
 * SECURITY.md). Registered in providerFactory.ts alongside [MockAIProvider]; selected
 * automatically when `ANTHROPIC_API_KEY` is set.
 */
export class AnthropicAIProvider implements AIProvider {
  readonly id = "anthropic";

  constructor(
    private readonly client: AnthropicMessagesClient,
    private readonly defaultModel: string,
  ) {}

  async generate(request: AIRequest): Promise<AIResponse> {
    const response = await this.client.create({
      model: request.modelConfig.model || this.defaultModel,
      max_tokens: request.modelConfig.maxTokens ?? 4096,
      temperature: request.modelConfig.temperature,
      system: request.systemPrompt,
      messages: toAnthropicMessages(request.messages),
      tools: toAnthropicTools(request.tools),
    });

    const content =
      response.stop_reason === "refusal"
        ? "I can't help with that request."
        : extractText(response.content);

    return {
      message: { role: "assistant", content },
      toolCalls: extractToolCalls(response.content),
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
      },
    };
  }

  async *streamGenerate(request: AIRequest): AsyncIterable<AIResponseChunk> {
    const stream = this.client.stream({
      model: request.modelConfig.model || this.defaultModel,
      max_tokens: request.modelConfig.maxTokens ?? 4096,
      temperature: request.modelConfig.temperature,
      system: request.systemPrompt,
      messages: toAnthropicMessages(request.messages),
      tools: toAnthropicTools(request.tools),
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { delta: event.delta.text, done: false };
      }
    }
    yield { delta: "", done: true };
  }
}

function toAnthropicMessages(messages: ConversationMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  for (const message of messages) {
    switch (message.role) {
      case "user":
      case "assistant":
        result.push({ role: message.role, content: message.content });
        break;
      case "tool":
        // No caller currently sends role "tool" without a matching tool_use_id — see
        // AI_ARCHITECTURE.md's multi-turn tool loop, not yet implemented by Orchestrator.
        result.push({ role: "user", content: message.content });
        break;
      case "system":
        // Handled via the top-level `system` field instead — see AIRequest.systemPrompt.
        break;
    }
  }
  return result;
}

function toAnthropicTools(tools: ToolDefinition[] | undefined): Anthropic.Tool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(tool.inputSchema.properties ?? {}).map(([field, type]) => [field, { type }]),
      ),
      required: tool.inputSchema.requiredFields,
    },
  }));
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function extractToolCalls(content: Anthropic.ContentBlock[]): ToolCallRequest[] {
  return content
    .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
    .map((block) => ({
      id: block.id,
      skillId: block.name,
      input: block.input as Record<string, unknown>,
    }));
}
