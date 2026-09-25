import type { AIProvider, AIRequest, AIResponse, AIResponseChunk } from "./provider.js";

const RETRYABLE_STATUS = /(?:^|\\D)(408|429|500|502|503|504)(?:\\D|$)/;

export class ResilientAIProvider implements AIProvider {
  readonly id: string;

  constructor(
    private readonly primary: AIProvider,
    private readonly fallback?: AIProvider,
  ) {
    this.id = fallback ? `${primary.id}+fallback:${fallback.id}` : primary.id;
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    try {
      return await this.primary.generate(request);
    } catch (error) {
      if (!this.fallback || !isRetryable(error)) throw error;
      return this.fallback.generate(request);
    }
  }

  async *streamGenerate(request: AIRequest): AsyncIterable<AIResponseChunk> {
    let yielded = false;
    try {
      for await (const chunk of this.primary.streamGenerate(request)) {
        if (!chunk.done) yielded = true;
        yield chunk;
      }
      return;
    } catch (error) {
      // Retrying a partially emitted stream would duplicate text. Only fail over when
      // the primary failed before producing any content.
      if (yielded || !this.fallback || !isRetryable(error)) throw error;
    }

    yield* this.fallback!.streamGenerate(request);
  }
}

export function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_STATUS.test(message) || /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(message);
}
