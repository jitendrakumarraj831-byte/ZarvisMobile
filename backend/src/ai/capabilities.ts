import type { AIRequest } from "./provider.js";

/**
 * What a model can do, as ZARVIS needs to know it. The gateway routes a request only to a model
 * that declares every capability the request needs; it never forces a capability onto a model
 * that does not have it (a tool-using request is not "made to work" by silently dropping the
 * tools, an image is not silently discarded).
 *
 * - `text`: ordinary text generation. Every usable model has it.
 * - `streaming`: incremental text deltas.
 * - `tools`: function/tool calling (the planner and every agentic turn need it).
 * - `vision`: image input (image analysis).
 * - `structuredOutput`: an enforced JSON response format.
 * - `longContext`: a context window of at least {@link LONG_CONTEXT_TOKENS}. Derived from the
 *   model's `contextTokens`, never declared separately, so the two cannot disagree.
 * - `coding`, `reasoning`: quality classes a caller can explicitly require
 *   (`AIRequest.requires`); e.g. repository changes require `coding`.
 */
export const CAPABILITIES = ["text", "streaming", "tools", "vision", "structuredOutput", "longContext", "coding", "reasoning"] as const;
export type Capability = (typeof CAPABILITIES)[number];
export type CapabilitySet = Readonly<Record<Capability, boolean>>;

/** A model with at least this many context tokens counts as `longContext`. */
export const LONG_CONTEXT_TOKENS = 100_000;

/** Output budget assumed when a request does not set `maxTokens` (used for the context-fit check). */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

export function capabilitySet(enabled: Iterable<Capability>, contextTokens: number): CapabilitySet {
  const on = new Set<Capability>(enabled);
  on.add("text");
  const set = {} as Record<Capability, boolean>;
  for (const capability of CAPABILITIES) set[capability] = on.has(capability);
  set.longContext = contextTokens >= LONG_CONTEXT_TOKENS;
  return set;
}

export function capabilityNames(set: CapabilitySet): Capability[] {
  return CAPABILITIES.filter((capability) => set[capability]);
}

/** What one request needs from whichever model answers it. */
export interface Requirements {
  capabilities: ReadonlySet<Capability>;
  /** Conservative estimate of the prompt size, in tokens. */
  estimatedPromptTokens: number;
  maxOutputTokens: number;
  /** Set for an image analysis: the model must accept this MIME type. */
  imageMimeType?: string;
}

/**
 * Prompt size estimate. Four characters per token is typical for English; Devanagari and other
 * scripts need far more tokens per character, and ZARVIS users write Hindi. Three characters per
 * token errs on the side of "this may not fit", which only ever withholds a fallback.
 */
export function estimatePromptTokens(request: Pick<AIRequest, "systemPrompt" | "messages" | "tools">): number {
  const messageChars = request.messages.reduce((sum, message) => sum + message.content.length, 0);
  const toolChars = request.tools?.length ? JSON.stringify(request.tools).length : 0;
  return Math.ceil((request.systemPrompt.length + messageChars + toolChars) / 3);
}

export function requirementsFor(
  request: AIRequest,
  extra: { streaming?: boolean; image?: { mimeType: string } } = {},
): Requirements {
  const needs = new Set<Capability>(["text", ...(request.requires ?? [])]);
  if (request.tools && request.tools.length > 0) needs.add("tools");
  if (request.responseFormat === "json") needs.add("structuredOutput");
  if (extra.streaming) needs.add("streaming");
  if (extra.image) needs.add("vision");
  return {
    capabilities: needs,
    estimatedPromptTokens: estimatePromptTokens(request),
    maxOutputTokens: request.modelConfig.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    imageMimeType: extra.image?.mimeType,
  };
}
