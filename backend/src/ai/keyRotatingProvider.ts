import { withKeySlot } from "./callTrace.js";
import { AIProviderError, abortError } from "./geminiErrors.js";
import type { AIProvider, AIRequest, AIResponse, AIResponseChunk, ImageAnalysisRequest, ImageAnalysisResult } from "./provider.js";
import { isAbortError } from "./transportErrors.js";
import type { KeyFailureReason, KeyLease, KeyRotator } from "../security/keyRotator.js";

/**
 * One AI provider with several API keys (`GROQ_KEYS=k1,k2`, `GEMINI_KEYS=...`): the ModelGateway sees one
 * provider, and inside it the keys take turns (security/keyRotator.ts).
 *
 * A request is sent with the active key. When the provider refuses that key for a reason that is about the
 * key (a rate limit, a spent quota, a rejected key), the key rests and the SAME request goes out at once
 * with the next key. Only when every key has been refused does the failure reach the gateway, which then
 * moves down its provider chain exactly as it does for a provider with one key. Any other failure (an
 * outage, a network error, a timeout, a refused request, a cancelled turn, a bug) is the same for every key
 * and leaves at once, so the gateway's next provider answers without waiting out more of this one.
 *
 * Streaming follows the rule the gateway follows for providers: the next key is tried only before any text
 * was delivered. Text that has reached the user is never restarted with another key.
 *
 * Each key has its own adapter, built once on first use. An adapter keeps state that belongs to its key
 * (Gemini remembers which of its models spent their daily quota), and a request never shares a key with
 * another request's retry. With several keys each upstream call records the key's slot (`keySlot`, 1-based)
 * in the turn's call log; the key itself is never logged. With one key nothing differs from the adapter alone.
 */
export interface KeyRotatingProviderOptions {
  /** The gateway's provider id (`groq`, `google`, ...). */
  id: string;
  rotator: KeyRotator;
  /**
   * Builds the adapter for one key. `hasAlternative` says, at the moment it is asked, whether another key
   * could take a request right now: an adapter may then skip waiting out a short rate limit on this key.
   */
  build(key: string, hasAlternative: () => boolean): AIProvider;
  /** Passed through for the gateway's structured-output routing. */
  supportsJsonSchema?: boolean;
}

/** Whether a failure is about the key that was used, and so worth the next key. */
export function keyFailureOf(error: unknown): { reason: KeyFailureReason; retryAfterMs?: number } | undefined {
  if (!(error instanceof AIProviderError)) return undefined;
  switch (error.kind) {
    case "AI_PROVIDER_RATE_LIMIT":
      return { reason: "rate_limited", retryAfterMs: error.retryAfterMs };
    case "AI_PROVIDER_QUOTA_EXCEEDED":
      return { reason: "quota_exhausted", retryAfterMs: error.retryAfterMs };
    case "AI_PROVIDER_AUTH_ERROR":
      return { reason: "auth_rejected" };
    default:
      return undefined;
  }
}

/** Runs `fn` tagged with the key's slot, when there is more than one key to tell apart. */
function tagged<T>(lease: KeyLease, fn: () => T): T {
  return lease.total > 1 ? withKeySlot(lease.slot, fn) : fn();
}

export class KeyRotatingProvider implements AIProvider {
  readonly id: string;
  readonly supportsJsonSchema?: boolean;
  private readonly adapters = new Map<string, AIProvider>();

  constructor(private readonly options: KeyRotatingProviderOptions) {
    this.id = options.id;
    if (options.supportsJsonSchema !== undefined) this.supportsJsonSchema = options.supportsJsonSchema;
  }

  get rotator(): KeyRotator {
    return this.options.rotator;
  }

  generate(request: AIRequest): Promise<AIResponse> {
    return this.withKeys(request.signal, (adapter) => adapter.generate(request));
  }

  analyzeImage(request: ImageAnalysisRequest): Promise<ImageAnalysisResult> {
    return this.withKeys(request.signal, (adapter) => {
      if (typeof adapter.analyzeImage !== "function") throw new Error(`${this.id} cannot analyze images`);
      return adapter.analyzeImage(request);
    });
  }

  async *streamGenerate(request: AIRequest): AsyncIterable<AIResponseChunk> {
    const leases = this.leases();
    let last: unknown;
    for (const lease of leases) {
      if (request.signal?.aborted) throw abortError();
      const iterator = this.adapter(lease).streamGenerate(request)[Symbol.asyncIterator]();
      let delivered = false;
      try {
        while (true) {
          // Each pull runs with the key's slot, so the record the adapter starts names it.
          const pulled = await tagged(lease, () => iterator.next());
          if (pulled.done) break;
          // The provider accepted this key. Recorded now: a consumer (the gateway) stops reading at the final
          // chunk, and code after the loop would then never run.
          if (!delivered) this.rotator.reportSuccess(lease);
          delivered = true;
          yield pulled.value;
        }
        return;
      } catch (error) {
        // Text has reached the user: this key owns the answer to its end.
        if (delivered) throw error;
        if (!this.rest(lease, error)) throw error;
        last = error;
      } finally {
        await iterator.return?.().catch(() => {});
      }
    }
    throw last;
  }

  /** Runs one call with the keys in turn. */
  private async withKeys<T>(signal: AbortSignal | undefined, call: (adapter: AIProvider) => Promise<T>): Promise<T> {
    let last: unknown;
    for (const lease of this.leases()) {
      if (signal?.aborted) throw abortError();
      try {
        const value = await tagged(lease, () => call(this.adapter(lease)));
        this.rotator.reportSuccess(lease);
        return value;
      } catch (error) {
        if (!this.rest(lease, error)) throw error;
        last = error;
      }
    }
    throw last;
  }

  /** Puts the key to rest when `error` is about it. False: the error is not the key's, and must leave as it is. */
  private rest(lease: KeyLease, error: unknown): boolean {
    if (isAbortError(error)) return false;
    const failure = keyFailureOf(error);
    if (!failure) return false;
    this.rotator.reportFailure(lease, failure.reason, failure.retryAfterMs);
    return true;
  }

  private leases(): KeyLease[] {
    const leases = this.rotator.plan();
    if (leases.length > 0) return leases;
    // The gateway asks only a configured provider; a key list emptied in between is reported like a missing key.
    throw new AIProviderError(`No ${this.rotator.name} API key is configured`, "AI_UNAVAILABLE", 503, false, undefined, undefined, {}, { provider: this.id });
  }

  private adapter(lease: KeyLease): AIProvider {
    let adapter = this.adapters.get(lease.key);
    if (!adapter) {
      const key = lease.key;
      adapter = this.options.build(key, () => this.rotator.hasAlternative(key));
      this.adapters.set(key, adapter);
    }
    return adapter;
  }
}
