/**
 * The voice boundary: everything `api/routes/tts.ts` knows about "something that speaks".
 *
 * The route asks for audio and gets audio, or a `TtsProviderError` that says what kind of failure
 * it was. It never learns how the voice is produced (today: Microsoft Edge's neural voices, see
 * `edgeTtsProvider.ts`), so the engine can change, or its network transport can move to a separate
 * service, without touching the route, the web client or the Android client.
 *
 * Audio contract, the same for every provider:
 * - `synthesize`: a playable WAV file, 24 kHz, 16-bit, mono (what Android's MediaPlayer and the
 *   web client's `new Audio()` play).
 * - `synthesizeStream`: headerless 16-bit little-endian mono PCM at 24 kHz, in order, as it is
 *   produced (what the web client's AudioContext schedules).
 */

export interface TtsOptions {
  /**
   * A voice the caller asked for (the request's `voice` field), exactly as received: anything
   * that is not a recognised voice is ignored and the voice is chosen from the text instead.
   */
  voice?: unknown;
  /** Aborting stops synthesis and releases the upstream connection. It is not a failure. */
  signal?: AbortSignal;
}

export interface TtsProvider {
  /** Names the engine in logs and in the `X-Zarvis-TTS` response header. */
  readonly id: string;
  /** The voice that speaks `text` when the caller names none (an English voice without text). */
  getDefaultVoice(text?: string): string;
  synthesize(text: string, options?: TtsOptions): Promise<Buffer>;
  synthesizeStream(text: string, options?: TtsOptions): AsyncIterable<Buffer>;
}

/**
 * - `INVALID_REQUEST`: there is nothing to say (the text is empty once it is made speakable).
 * - `UNAVAILABLE`: could not reach the service, it closed early, it is rate limiting, or this
 *   server is protecting it (too many in flight, or it failed repeatedly just now).
 * - `TIMEOUT`: no answer in time.
 * - `REJECTED`: the service refused the connection (blocked address, changed protocol).
 * - `NO_AUDIO`: the service finished without producing sound for this text.
 * - `BAD_AUDIO`: it produced audio that cannot be played correctly (malformed, wrong format).
 */
export type TtsErrorKind = "INVALID_REQUEST" | "UNAVAILABLE" | "TIMEOUT" | "REJECTED" | "NO_AUDIO" | "BAD_AUDIO";

export class TtsProviderError extends Error {
  constructor(
    message: string,
    readonly kind: TtsErrorKind,
    /** Whether asking again later can succeed. Sent to clients as `retryable`. */
    readonly retryable: boolean,
    options: { cause?: unknown; retryAfterMs?: number } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TtsProviderError";
    this.retryAfterMs = options.retryAfterMs;
  }

  readonly retryAfterMs?: number;
}

/** A cancelled request, however it was cancelled (a client disconnect, `Stop`, a newer turn). */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

/** Waits `ms`, or rejects with an `AbortError` as soon as `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
