/**
 * ElevenLabs' voices behind the same `TtsProvider` boundary as Gemini's (`geminiTtsProvider.ts`) and
 * Microsoft Edge's (`edgeTtsProvider.ts`). Chosen with `TTS_PROVIDER=elevenlabs`; the route, the web client
 * and the Android client do not change.
 *
 * The request is ElevenLabs' streaming text-to-speech endpoint
 * (`POST /v1/text-to-speech/{voice_id}/stream?output_format=pcm_24000`, key in `xi-api-key`), which answers
 * with raw 16-bit little-endian mono PCM at 24 kHz: the audio contract every voice here shares, so nothing is
 * decoded or resampled. The unary WAV endpoint is that stream collected and given a header.
 *
 * What it promises:
 * - No retry here. A rate limit, a spent credit balance, an outage or a timeout is reported at once as a
 *   `TtsProviderError`, and the `FallbackTtsProvider` in front of it asks the next voice before any sound
 *   was produced. Sound that has started is never repeated.
 * - A cancelled request stops the upstream response and is never reported as a failure.
 * - Concurrency is capped (`Semaphore`), and nothing the user said is logged: only the engine, the voice,
 *   the model, sizes and timings. The API key travels in a header, never in a URL or a log.
 */
import { readWithIdleLimit } from "../ai/transportErrors.js";
import { logger } from "../security/redact.js";
import { Semaphore } from "./guard.js";
import { TtsProviderError, abortError, isAbortError, type TtsOptions, type TtsProvider } from "./provider.js";
import { speakableText } from "./ssml.js";
import { detectSpeechLanguage } from "./voices.js";
import { TTS_SAMPLE_RATE, pcmToWav } from "./wav.js";

/** A multilingual low-latency model that speaks Hindi and English (ElevenLabs' own name). */
export const DEFAULT_ELEVENLABS_MODEL = "eleven_flash_v2_5";
/** "Rachel", one of ElevenLabs' premade voices. Any voice id from the account's voice library may be set instead. */
export const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_BASE_URL = "https://api.elevenlabs.io";

/** Reported as the voice name (`X-Zarvis-TTS-Voice`), so an ElevenLabs voice can never be taken for another engine's. */
export function elevenLabsVoiceLabel(voiceId: string): string {
  return `elevenlabs:${voiceId}`;
}

export interface ElevenLabsTtsProviderOptions {
  /** The key, or a function that reads it when a request is made (so a rotated key is picked up). */
  apiKey: string | undefined | (() => string | undefined);
  /** The voice id that speaks every reply. */
  voiceId: string;
  model: string;
  baseUrl?: string;
  /** The wire. Production uses `fetch`; tests pass a fake. */
  fetchImpl?: typeof fetch;
  /** How long to wait for the response headers (default 30 s). */
  timeoutMs?: number;
  /** How long the audio may go quiet once it has started before the call is given up (default 20 s). */
  idleTimeoutMs?: number;
  maxConcurrent?: number;
  maxQueued?: number;
  /**
   * The in-flight limit to share. Several keys mean several instances of this provider (one per key); they share
   * one limit, so a second key does not double how many syntheses this server holds open.
   */
  slots?: Semaphore;
  /** Longest text one call accepts (default 4000 characters), a limit behind the route's own. */
  maxTextChars?: number;
  now?: () => number;
}

export class ElevenLabsTtsProvider implements TtsProvider {
  readonly id = "elevenlabs";

  private readonly slots: Semaphore;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly maxTextChars: number;
  private readonly now: () => number;

  constructor(private readonly options: ElevenLabsTtsProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 20_000;
    this.maxTextChars = options.maxTextChars ?? 4000;
    this.now = options.now ?? Date.now;
    this.slots = options.slots ?? new Semaphore(options.maxConcurrent ?? 8, options.maxQueued ?? 16);
  }

  getDefaultVoice(): string {
    return elevenLabsVoiceLabel(this.options.voiceId);
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
    // A caller's voice name belongs to another engine (Edge, Gemini): the configured ElevenLabs voice speaks.
    const voiceId = this.options.voiceId;
    options.onResolved?.({ voice: elevenLabsVoiceLabel(voiceId), language: detectSpeechLanguage(prepared), engine: this.id });
    if (signal?.aborted) throw abortError();
    const key = typeof this.options.apiKey === "function" ? this.options.apiKey() : this.options.apiKey;
    if (!key) throw new TtsProviderError("No ElevenLabs API key is configured for the voice", "REJECTED", false);

    const release = await this.slots.acquire(signal);
    const started = this.now();
    try {
      const response = await this.send(prepared, voiceId, key, signal);
      let pcmBytes = 0;
      for await (const pcm of this.readPcm(response, signal)) {
        pcmBytes += pcm.length;
        yield pcm;
      }
      if (pcmBytes === 0) throw new TtsProviderError("The voice service finished without producing sound", "NO_AUDIO", false);
      logger.info("TTS call", { engine: this.id, voice: voiceId, model: this.options.model, chars: prepared.length, pcmBytes, totalMs: this.now() - started });
    } finally {
      release();
    }
  }

  private prepare(text: string): string {
    const speakable = typeof text === "string" ? speakableText(text.slice(0, this.maxTextChars)) : "";
    // Punctuation or emoji alone has no sound; there is nothing to ask a voice for.
    if (!/[\p{L}\p{N}]/u.test(speakable)) throw new TtsProviderError("There is nothing to say", "INVALID_REQUEST", false);
    return speakable;
  }

  /** One request, no retry: any failure leaves as a `TtsProviderError` for the fallback to act on. */
  private async send(text: string, voiceId: string, key: string, signal?: AbortSignal): Promise<Response> {
    const url = `${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=pcm_${TTS_SAMPLE_RATE}`;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "audio/pcm", "xi-api-key": key },
        body: JSON.stringify({ text, model_id: this.options.model }),
        signal: signal ? AbortSignal.any([timeout.signal, signal]) : timeout.signal,
        redirect: "error",
      });
    } catch (error) {
      if (signal?.aborted || (isAbortError(error) && !timeout.signal.aborted)) throw abortError();
      if (timeout.signal.aborted) throw new TtsProviderError("The ElevenLabs voice did not answer in time", "TIMEOUT", true, { cause: error });
      throw new TtsProviderError("Could not reach the ElevenLabs voice service", "UNAVAILABLE", true, { cause: error });
    } finally {
      clearTimeout(timer);
    }
    if (response.ok) return response;
    const detail = await response.text().catch(() => "");
    throw elevenLabsError(response.status, detail, response.headers.get("retry-after"));
  }

  /** The PCM answer, in order, never splitting a 16-bit sample between two chunks. */
  private async *readPcm(response: Response, signal?: AbortSignal): AsyncGenerator<Buffer> {
    if (!response.body) throw new TtsProviderError("The ElevenLabs voice answered with no body", "NO_AUDIO", false);
    const reader = response.body.getReader();
    let carry: Buffer | undefined;
    try {
      while (true) {
        if (signal?.aborted) throw abortError();
        let read: Awaited<ReturnType<typeof reader.read>>;
        try {
          read = await readWithIdleLimit(() => reader.read(), this.idleTimeoutMs, () => new TtsProviderError("The ElevenLabs voice stopped sending audio", "TIMEOUT", true));
        } catch (error) {
          if (signal?.aborted || isAbortError(error)) throw abortError();
          if (error instanceof TtsProviderError) throw error;
          throw new TtsProviderError("The ElevenLabs voice stream was cut off", "UNAVAILABLE", true, { cause: error });
        }
        if (read.done) break;
        const joined = carry ? Buffer.concat([carry, Buffer.from(read.value)]) : Buffer.from(read.value);
        const usable = joined.length - (joined.length % 2);
        carry = usable < joined.length ? joined.subarray(usable) : undefined;
        if (usable > 0) yield joined.subarray(0, usable);
      }
    } finally {
      // Also runs when the consumer stops early (the client went away): cancel the upstream response.
      await reader.cancel().catch(() => undefined);
    }
  }
}

/**
 * An ElevenLabs refusal as the voice boundary names it. ElevenLabs reports `{"detail": {"status", "message"}}`;
 * a spent character quota arrives as 401 with `detail.status: "quota_exceeded"`, which is not a bad key. The
 * service's own words stay out of the message (they can quote the text).
 *
 * `keyFailure` says when the refusal is about the key (its quota, its rate or concurrency limit, the key itself),
 * so another key may speak instead. "system_busy" is ElevenLabs as a whole being overloaded: the same for every key.
 */
export function elevenLabsError(status: number, bodyText: string, retryAfter: string | null): TtsProviderError {
  let reason = "";
  try {
    const detail = (JSON.parse(bodyText) as { detail?: { status?: unknown } }).detail;
    // A short code such as "quota_exceeded" or "voice_not_found"; anything else is not repeated.
    if (typeof detail?.status === "string" && /^[a-z_]{1,40}$/i.test(detail.status)) reason = detail.status.toLowerCase();
  } catch {
    // not JSON: the status decides
  }
  const seconds = Number(retryAfter);
  const retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
  if (reason === "quota_exceeded" || status === 402) {
    return new TtsProviderError("The ElevenLabs voice has used up its character quota", "UNAVAILABLE", false, { keyFailure: "quota_exhausted" });
  }
  if (status === 429) {
    return new TtsProviderError("The ElevenLabs voice is rate limited", "UNAVAILABLE", true, { retryAfterMs, ...(reason === "system_busy" ? {} : { keyFailure: "rate_limited" as const }) });
  }
  if (status >= 500 || status === 408) return new TtsProviderError("The ElevenLabs voice is unavailable", "UNAVAILABLE", true, { retryAfterMs });
  return new TtsProviderError(`The ElevenLabs voice refused the request (HTTP ${status}${reason ? `, ${reason}` : ""})`, "REJECTED", false, {
    ...(status === 401 || status === 403 ? { keyFailure: "auth_rejected" as const } : {}),
  });
}
