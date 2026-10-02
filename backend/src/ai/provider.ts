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

/**
 * Per-turn accounting a provider fills in, so one user turn's real cost (every HTTP request,
 * including retries) is observable in one log line. Optional: callers that don't care omit it.
 */
export interface ProviderTrace {
  /** HTTP requests actually sent to the provider, retries included. */
  httpRequests: number;
  /** Provider-side ids of the responses (e.g. Gemini `responseId`), when returned. */
  responseIds: string[];
}

export interface AIRequest {
  systemPrompt: string;
  messages: ConversationMessage[];
  tools?: ToolDefinition[];
  modelConfig: ModelConfiguration;
  /** Cancels the request (and any retry wait) when the user's turn is abandoned. */
  signal?: AbortSignal;
  trace?: ProviderTrace;
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
