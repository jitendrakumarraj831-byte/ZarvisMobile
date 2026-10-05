import { logger } from "../security/redact.js";
import type { AIProvider, AIRequest, AIResponse, AIResponseChunk } from "./provider.js";

/**
 * Tries `primary` (Gemini) and, when it fails for any reason other than the user cancelling,
 * answers from `secondary` (OpenRouter) instead. This is the cross-provider fallback that the
 * Gemini adapter alone cannot give: a daily Gemini quota, a bad/expired key or a long outage
 * would otherwise fail every turn even though a second provider is configured.
 *
 * For streaming, the fallback only happens before the first chunk was yielded, so an
 * already-rendered partial reply is never duplicated or mixed with another model's text.
 */
export class FallbackProvider implements AIProvider {
  readonly id: string;

  constructor(
    private readonly primary: AIProvider,
    private readonly secondary: AIProvider,
    private readonly secondaryModel: string,
  ) {
    this.id = primary.id;
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    try {
      return await this.primary.generate(request);
    } catch (error) {
      this.rethrowIfAborted(request, error);
      this.logFallback(error);
      return this.secondary.generate(this.forSecondary(request));
    }
  }

  async *streamGenerate(request: AIRequest): AsyncIterable<AIResponseChunk> {
    let yielded = false;
    try {
      for await (const chunk of this.primary.streamGenerate(request)) {
        yielded = true;
        yield chunk;
      }
      return;
    } catch (error) {
      this.rethrowIfAborted(request, error);
      if (yielded) throw error;
      this.logFallback(error);
    }
    yield* this.secondary.streamGenerate(this.forSecondary(request));
  }

  private forSecondary(request: AIRequest): AIRequest {
    return { ...request, modelConfig: { ...request.modelConfig, provider: this.secondary.id, model: this.secondaryModel } };
  }

  private rethrowIfAborted(request: AIRequest, error: unknown): void {
    if (request.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
  }

  private logFallback(error: unknown): void {
    logger.warn("Primary AI provider failed; falling back", {
      primary: this.primary.id,
      fallback: this.secondary.id,
      reason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
  }
}
