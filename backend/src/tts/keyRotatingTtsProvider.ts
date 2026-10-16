/**
 * One voice service with several API keys (`ELEVENLABS_KEYS=k1,k2`): the voice chain sees one voice, and inside
 * it the keys take turns (security/keyRotator.ts).
 *
 * A sentence is spoken with the active key. When the service refuses that key before any sound (its character
 * quota is spent, it is rate limited, the key is rejected: `TtsProviderError.keyFailure`), the key rests and the
 * same sentence is asked of the next key at once. Only when every key has been refused does the failure reach
 * the `FallbackTtsProvider` in front of this one, which then asks the next voice (Gemini, Edge) as it always has.
 *
 * Anything else is the same for every key and leaves at once: the service is down or slow, there is nothing to
 * say, this server is full (`local`), the request was cancelled. And once sound has started, that key owns the
 * sentence to its end: two keys never speak parts of one sentence, nothing is repeated. The unary WAV call may
 * change key after a failure mid-way, because nothing has left the server until it is complete.
 */
import type { KeyLease, KeyRotator } from "../security/keyRotator.js";
import { TtsProviderError, abortError, isAbortError, type TtsOptions, type TtsProvider } from "./provider.js";

export interface KeyRotatingTtsProviderOptions {
  /** The engine's id (`elevenlabs`), reported in `X-Zarvis-TTS`. */
  id: string;
  rotator: KeyRotator;
  /** Builds the voice for one key; called once per key, on first use. */
  build(key: string): TtsProvider;
}

export class KeyRotatingTtsProvider implements TtsProvider {
  readonly id: string;
  private readonly voices = new Map<string, TtsProvider>();

  constructor(private readonly options: KeyRotatingTtsProviderOptions) {
    this.id = options.id;
  }

  getDefaultVoice(text?: string): string {
    const [lease] = this.options.rotator.plan();
    if (!lease) throw new TtsProviderError(`No ${this.options.rotator.name} API key is configured for the voice`, "REJECTED", false);
    return this.voice(lease).getDefaultVoice(text);
  }

  async synthesize(text: string, options: TtsOptions = {}): Promise<Buffer> {
    let last: unknown;
    for (const lease of this.leases()) {
      if (options.signal?.aborted) throw abortError();
      try {
        const wav = await this.voice(lease).synthesize(text, options);
        this.options.rotator.reportSuccess(lease);
        return wav;
      } catch (error) {
        if (!this.rest(lease, error, options)) throw error;
        last = error;
      }
    }
    throw last;
  }

  async *synthesizeStream(text: string, options: TtsOptions = {}): AsyncGenerator<Buffer> {
    let last: unknown;
    for (const lease of this.leases()) {
      if (options.signal?.aborted) throw abortError();
      let produced = false;
      try {
        for await (const chunk of this.voice(lease).synthesizeStream(text, options)) {
          // The service accepted this key. Recorded at the first sound: a listener who leaves mid-sentence stops
          // the stream, and code after the loop would then never run.
          if (!produced) this.options.rotator.reportSuccess(lease);
          produced = true;
          yield chunk;
        }
        return;
      } catch (error) {
        // Sound has started: this key owns the sentence. Another key would repeat or mix it.
        if (produced) throw error;
        if (!this.rest(lease, error, options)) throw error;
        last = error;
      }
    }
    throw last;
  }

  /** Puts the key to rest when the failure is about it. False: leave with the error as it is. */
  private rest(lease: KeyLease, error: unknown, options: TtsOptions): boolean {
    if (options.signal?.aborted || isAbortError(error)) return false;
    if (!(error instanceof TtsProviderError) || !error.keyFailure || error.local) return false;
    this.options.rotator.reportFailure(lease, error.keyFailure, error.retryAfterMs);
    return true;
  }

  private leases(): KeyLease[] {
    const leases = this.options.rotator.plan();
    if (leases.length === 0) throw new TtsProviderError(`No ${this.options.rotator.name} API key is configured for the voice`, "REJECTED", false);
    return leases;
  }

  private voice(lease: KeyLease): TtsProvider {
    let voice = this.voices.get(lease.key);
    if (!voice) {
      voice = this.options.build(lease.key);
      this.voices.set(lease.key, voice);
    }
    return voice;
  }
}
