import type { JsonSchema } from "../domain/types.js";
import type { Capability } from "./capabilities.js";

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
  /**
   * Other models of the SAME provider that may answer if `model` cannot (chosen by the gateway from the
   * provider's live catalog). OpenRouter tries them in order inside one HTTP request (its `models`
   * parameter), so this adds no request of ours. Providers that have no such feature ignore it.
   */
  fallbackModels?: string[];
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
  /**
   * The model that actually answered each successful request, in order. Differs from the
   * configured model when the provider fell back (404 / 5xx), so a switch is never silent.
   */
  servedModels?: string[];
}

/** A reply that must match a JSON Schema (OpenAI-style `json_schema` structured output). */
export interface JsonSchemaFormat {
  type: "json_schema";
  /** `[A-Za-z0-9_-]{1,64}`: the provider's name for the schema. */
  name: string;
  schema: Record<string, unknown>;
  /** Default true: the provider must follow the schema exactly. */
  strict?: boolean;
}

export interface AIRequest {
  systemPrompt: string;
  messages: ConversationMessage[];
  tools?: ToolDefinition[];
  modelConfig: ModelConfiguration;
  /** Cancels the request (and any retry wait) when the user's turn is abandoned. */
  signal?: AbortSignal;
  trace?: ProviderTrace;
  /** Correlation id of this logical model call (generated when absent). */
  modelCallId?: string;
  /** Who is calling: the orchestrator's planner, or a skill generating content. */
  purpose?: "planner" | "generation";
  /**
   * Capabilities the caller needs beyond what the request already implies (tools present imply
   * `tools`). The gateway only routes the request to a model that declares all of them, e.g.
   * repository changes require `coding`. See ai/capabilities.ts.
   */
  requires?: Capability[];
  /**
   * `"json"`: the reply must be a JSON document. A {@link JsonSchemaFormat}: it must also match that
   * schema. Only a model declaring `structuredOutput` answers, and a schema only goes to a provider
   * whose adapter sets `supportsJsonSchema`.
   */
  responseFormat?: "json" | JsonSchemaFormat;
}

export interface ToolCallRequest {
  id: string;
  skillId: string;
  input: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  /** What the provider charged for the call, in US dollars, when it reports it (OpenRouter does). */
  costUsd?: number;
}

/**
 * Who actually answered one logical model call, and whether that was a fallback. Produced by the
 * ModelGateway so a provider switch is never silent. Internal: it is logged and returned to
 * server code, never copied into a client response.
 */
export interface AICallMeta {
  /** Provider id that produced the answer (`google`, `openrouter`, ...). */
  provider: string;
  /** The model that answered (the provider's own report when it gives one). */
  model: string;
  /** The model the gateway chose for that provider. Differs from `model` when a router served another. */
  configuredModel: string;
  fallback: boolean;
  /** Why the request left the primary provider, e.g. `GEMINI_QUOTA_EXCEEDED`. Set only when `fallback`. */
  fallbackReason?: string;
  /** Provider attempts made by this logical call: 1 normally, 2 after a fallback. */
  attempts: number;
  latencyMs: number;
  modelCallId: string;
}

export interface AIResponse {
  message: ConversationMessage;
  toolCalls: ToolCallRequest[];
  usage: TokenUsage;
  /** Set by the ModelGateway; absent for a response produced by a bare provider. */
  meta?: AICallMeta;
}

export interface AIResponseChunk {
  delta: string;
  done: boolean;
  /** On the final (`done`) chunk, when the stream came through the ModelGateway. */
  meta?: AICallMeta;
}

export interface ImageAnalysisRequest {
  data: Buffer;
  mimeType: string;
  modelConfig: ModelConfiguration;
  signal?: AbortSignal;
  trace?: ProviderTrace;
  modelCallId?: string;
}

export interface ImageAnalysisResult {
  text: string;
  meta?: AICallMeta;
}

export interface AIProvider {
  readonly id: string;
  /** True when the adapter can send a {@link JsonSchemaFormat}. Absent means it can only ask for `"json"`. */
  readonly supportsJsonSchema?: boolean;
  generate(request: AIRequest): Promise<AIResponse>;
  streamGenerate(request: AIRequest): AsyncIterable<AIResponseChunk>;
  /**
   * Image understanding. Optional: a provider without it simply cannot be routed an image, and
   * must not declare `vision` in the model catalog.
   */
  analyzeImage?(request: ImageAnalysisRequest): Promise<ImageAnalysisResult>;
}
