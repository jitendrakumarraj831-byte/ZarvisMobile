/**
 * ZARVIS's voice: Microsoft Edge's neural voices (Hindi `hi-IN-SwaraNeural`, English
 * `en-US-JennyNeural` by default), behind the `TtsProvider` boundary.
 *
 * One request is: make the text speakable, pick the voice from the text (or the caller's valid
 * choice), split it into parts the service accepts, and for each part in order send SSML to the
 * transport, decode the MP3 it streams back into 24 kHz 16-bit mono PCM, and yield that. The
 * unary WAV endpoint is the same stream collected and given a header, so the two endpoints can
 * never disagree about how a text sounds.
 *
 * What it promises:
 * - Audio never repeats and never mixes: a part is retried only if it has produced no sound yet,
 *   a failure after sound has started surfaces (the stream ends there), and each request owns its
 *   connection and its decoder.
 * - Retries are bounded (two tries a part, one short pause) and only for failures that can be
 *   temporary. There is no other provider to fall back to, and none is invented.
 * - A cancelled request stops the upstream connection and is never reported as a failure.
 * - The service is protected: a cap on syntheses in flight (`Semaphore`) and a pause after
 *   repeated failures (`CircuitBreaker`), see `guard.ts`.
 * - Nothing the user said is logged: only the engine, the voice, sizes and timings.
 */
import { logger } from "../security/redact.js";
import { WebSocketEdgeTransport, type EdgeTransport } from "./edgeTransport.js";
import { CircuitBreaker, Semaphore } from "./guard.js";
import { Mp3PcmDecoder } from "./mp3Decoder.js";
import { TtsProviderError, abortError, isAbortError, sleep, type TtsOptions, type TtsProvider } from "./provider.js";
import { buildSsml, escapeXml, speakableText, splitForSynthesis } from "./ssml.js";
import { resolveVoice, type ResolvedVoice, type VoiceSettings } from "./voices.js";
import { TTS_SAMPLE_RATE, pcmToWav } from "./wav.js";

export interface EdgeTtsProviderOptions {
  voices: VoiceSettings;
  /** The wire. Production uses `WebSocketEdgeTransport`; tests pass a fake. */
  transport?: EdgeTransport;
  /** Syntheses in flight in this process (default 8) and how many may wait behind them (default 16). */
  maxConcurrent?: number;
  maxQueued?: number;
  /** Longest text one call accepts, a limit behind the route's own (default 4000 characters). */
  maxTextChars?: number;
  /** Most escaped bytes of text in one request to the service (default 3000; its limit is about 4096). */
  maxPartBytes?: number;
  /** Pause before the one retry of a part (default 300 ms). */
  retryDelayMs?: number;
  /** Requests failing in a row that open the breaker (default 3) and for how long (default 30 s). */
  breakerThreshold?: number;
  breakerOpenMs?: number;
  now?: () => number;
}

const ATTEMPTS_PER_PART = 2;

export class EdgeTtsProvider implements TtsProvider {
  readonly id = "edge";

  private readonly voices: VoiceSettings;
  private readonly transport: EdgeTransport;
  private readonly slots: Semaphore;
  private readonly breaker: CircuitBreaker;
  private readonly maxTextChars: number;
  private readonly maxPartBytes: number;
  private readonly retryDelayMs: number;
  private readonly now: () => number;

  constructor(options: EdgeTtsProviderOptions) {
    this.voices = options.voices;
    this.transport = options.transport ?? new WebSocketEdgeTransport();
    this.now = options.now ?? Date.now;
    this.slots = new Semaphore(options.maxConcurrent ?? 8, options.maxQueued ?? 16);
    this.breaker = new CircuitBreaker(options.breakerThreshold ?? 3, options.breakerOpenMs ?? 30_000, this.now);
    this.maxTextChars = options.maxTextChars ?? 4000;
    this.maxPartBytes = options.maxPartBytes ?? 3000;
    this.retryDelayMs = options.retryDelayMs ?? 300;
  }

  getDefaultVoice(text = ""): string {
    return resolveVoice(text, undefined, this.voices).voice;
  }

  /** A WAV file: the stream, collected, with a header. */
  async synthesize(text: string, options: TtsOptions = {}): Promise<Buffer> {
    const pieces: Buffer[] = [];
    for await (const pcm of this.synthesizeStream(text, options)) pieces.push(pcm);
    const pcm = Buffer.concat(pieces);
    if (pcm.length === 0) throw new TtsProviderError("The voice service produced no audio", "NO_AUDIO", false);
    return pcmToWav(pcm, TTS_SAMPLE_RATE);
  }

  async *synthesizeStream(text: string, options: TtsOptions = {}): AsyncGenerator<Buffer> {
    const { signal } = options;
    const prepared = this.prepare(text);
    const voice = resolveVoice(prepared, options.voice, this.voices);
    options.onResolved?.({ voice: voice.voice, language: voice.language });
    const parts = splitForSynthesis(prepared, this.maxPartBytes);
    if (signal?.aborted) throw abortError();

    const release = await this.slots.acquire(signal);
    const started = this.now();
    let admitted = false;
    let outcome: "ok" | "failed" | "neutral" = "neutral";
    let decoder: Mp3PcmDecoder | undefined;
    let pcmBytes = 0;
    let firstAudioMs: number | undefined;
    try {
      this.breaker.allow();
      admitted = true;
      decoder = await Mp3PcmDecoder.create();
      for (const [index, part] of parts.entries()) {
        for await (const pcm of this.speakPart(part, voice, decoder, index > 0, signal)) {
          firstAudioMs ??= this.now() - started;
          pcmBytes += pcm.length;
          yield pcm;
        }
      }
      outcome = "ok";
      logger.info("TTS call", {
        engine: this.id,
        voice: voice.voice,
        language: voice.language,
        voiceSource: voice.source,
        chars: prepared.length,
        parts: parts.length,
        pcmBytes,
        firstAudioMs,
        totalMs: this.now() - started,
      });
    } catch (error) {
      outcome = error instanceof TtsProviderError && ["UNAVAILABLE", "TIMEOUT", "REJECTED"].includes(error.kind) ? "failed" : "neutral";
      throw error;
    } finally {
      decoder?.close();
      // Only a request that was let through may report on the service. One that was refused by the
      // breaker, or abandoned half way, must not close it or reopen it.
      if (admitted) {
        if (outcome === "ok") this.breaker.success();
        else if (outcome === "failed") this.breaker.failure();
        else this.breaker.neutral();
      }
      release();
    }
  }

  private prepare(text: string): string {
    const speakable = typeof text === "string" ? speakableText(text.slice(0, this.maxTextChars)) : "";
    // Punctuation or emoji alone has no sound; the service would answer with silence and an error.
    if (!/[\p{L}\p{N}]/u.test(speakable)) throw new TtsProviderError("There is nothing to say", "INVALID_REQUEST", false);
    return speakable;
  }

  /** One part of the text: tries, and yields PCM. A try that has already produced sound is never repeated. */
  private async *speakPart(part: string, voice: ResolvedVoice, decoder: Mp3PcmDecoder, resetFirst: boolean, signal?: AbortSignal): AsyncGenerator<Buffer> {
    const ssml = buildSsml(voice.voice, voice.locale, escapeXml(part));
    for (let attempt = 1; ; attempt += 1) {
      let produced = false;
      try {
        if (resetFirst || attempt > 1) await decoder.reset();
        for await (const mp3 of this.transport.synthesize(ssml, signal)) {
          const pcm = decoder.push(mp3);
          if (pcm.length > 0) {
            produced = true;
            yield pcm;
          }
        }
        if (decoder.decodedSamples === 0) throw new TtsProviderError("The voice service sent audio that contained no sound", "BAD_AUDIO", false);
        return;
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) throw abortError();
        const failure =
          error instanceof TtsProviderError ? error : new TtsProviderError("Voice synthesis failed", "UNAVAILABLE", false, { cause: error });
        if (produced || !failure.retryable || attempt >= ATTEMPTS_PER_PART) throw failure;
        logger.warn("TTS attempt failed; trying once more", { engine: this.id, kind: failure.kind, attempt });
        await sleep(this.retryDelayMs, signal);
      }
    }
  }
}
