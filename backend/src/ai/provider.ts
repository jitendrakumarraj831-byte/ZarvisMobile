import type { JsonSchema } from "../domain/types.js";

/**
 * Provider-agnostic AI contract — see AI_ARCHITECTURE.md. No caller depends on a specific
 * vendor's SDK; adding a real provider means implementing this interface once.
 */
export interface ToolDefinition {
  /** The skill id this tool definition was derived from. */
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export type ConversationRole = "system" | "user" | "assistant" | "tool";

export interface ConversationMessage {
  role: ConversationRole;
  content: string;
}

export interface ModelConfiguration {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIRequest {
  systemPrompt: string;
  messages: ConversationMessage[];
  tools?: ToolDefinition[];
  modelConfig: ModelConfiguration;
}

export interface ToolCallRequest {
  id: string;
  skillId: string;
  input: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface AIResponse {
  message: ConversationMessage;
  toolCalls: ToolCallRequest[];
  usage: TokenUsage;
}

export interface AIResponseChunk {
  delta: string;
  done: boolean;
}

export interface AIProvider {
  readonly id: string;
  generate(request: AIRequest): Promise<AIResponse>;
  streamGenerate(request: AIRequest): AsyncIterable<AIResponseChunk>;
}
