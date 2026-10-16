/**
 * One voice, with a second behind it. `primary` (Microsoft Edge's voices) speaks; if it fails before
 * it has produced any sound, `secondary` (Gemini's voice) speaks the same text instead.
 *
 * Why this exists: the Edge service is unofficial, undocumented and has changed what it requires
 * before. When it refuses this server, spoken replies would stop for everyone. Falling back keeps
 * them working, and says so (`X-Zarvis-TTS`, `X-Zarvis-TTS-Voice` and the log).
 *
 * The rules, which are the same ones the AI Model Gateway follows for text:
 * - One hop, never back: the secondary is asked only after the primary has failed, and its failure
 *   is final.
 * - Only before the first sound. Once the primary has yielded audio, a failure surfaces and the
 *   stream ends there: two voices are never mixed in one reply, and nothing is repeated.
 * - Not for a request that is not the primary's fault: there is nothing to say (`INVALID_REQUEST`:
 *   the secondary would say the same), the request was cancelled (never a failure), or this server
 *   is full (`local`: its own limit on syntheses in flight says nothing about the primary service,
 *   and a crowd here must not become a crowd of texts sent to the second service).
 * - The unary WAV endpoint is different in one way only: it returns nothing until it is complete, so
 *   it may fall back even after the primary had started, because no audio has left the server.
 * - Nothing the user said is logged: only the engines, the kind of failure and this server's own description of it.
 */
import { logger } from "../security/redact.js";
import { TtsProviderError, isAbortError, type TtsOptions, type TtsProvider } from "./provider.js";

export class FallbackTtsProvider implements TtsProvider {
  /** The primary's id: a request that never needed the fallback is indistinguishable from one without it. */
  readonly id: string;

  constructor(
    private readonly primary: TtsProvider,
    private readonly secondary: TtsProvider,
  ) {
    this.id = primary.id;
  }

  getDefaultVoice(text?: string): string {
    return this.primary.getDefaultVoice(text);
  }

  async synthesize(text: string, options: TtsOptions = {}): Promise<Buffer> {
    try {
      return await this.primary.synthesize(text, options);
    } catch (error) {
      this.rethrowUnlessFallbackWorthy(error, options);
      this.logFallback(error);
    }
    return this.secondary.synthesize(text, options);
  }

  async *synthesizeStream(text: string, options: TtsOptions = {}): AsyncGenerator<Buffer> {
    let produced = false;
    try {
      for await (const chunk of this.primary.synthesizeStream(text, options)) {
        produced = true;
        yield chunk;
      }
      return;
    } catch (error) {
      // Sound has started: this voice owns the reply to its end. A second voice would repeat or mix it.
      if (produced) throw error;
      this.rethrowUnlessFallbackWorthy(error, options);
      this.logFallback(error);
    }
    yield* this.secondary.synthesizeStream(text, options);
  }

  /** Throws `error` itself when the secondary would not help; returns when it should be tried. */
  private rethrowUnlessFallbackWorthy(error: unknown, options: TtsOptions): void {
    if (options.signal?.aborted || isAbortError(error)) throw error;
    if (error instanceof TtsProviderError && (error.kind === "INVALID_REQUEST" || error.local)) throw error;
  }

  private logFallback(error: unknown): void {
    logger.warn("Primary voice failed; using the fallback voice", {
      primary: this.primary.id,
      fallback: this.secondary.id,
      kind: error instanceof TtsProviderError ? error.kind : "UNEXPECTED",
      // Why, in this server's own words (an HTTP status, a service code such as "quota_exceeded"): the kind alone
      // cannot tell a rejected key from a missing voice. The service's own text stays in `cause`, never here.
      ...(error instanceof TtsProviderError ? { detail: error.message.slice(0, 200) } : {}),
    });
  }
}
