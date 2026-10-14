/**
 * The second voice: Gemini's native-audio speech, behind the same `TtsProvider` boundary as
 * Microsoft Edge's voices (`edgeTtsProvider.ts`). It exists so that spoken replies do not stop when
 * the unofficial Edge service refuses this server (a protocol change, a blocked cloud address): the
 * `FallbackTtsProvider` asks it only after Edge has failed before producing any sound.
 *
 * The request follows Google's documented speech-generation contract
 * (`generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`) and uses the streaming
 * method, which returns raw 16-bit little-endian mono PCM at 24 kHz. The unary WAV endpoint is that
 * stream collected and given a header, so the two endpoints cannot disagree about how a text sounds.
 *
 * What it promises:
 * - The same audio contract as every voice (24 kHz, 16-bit, mono). A stream that reports another
 *   sample rate is refused rather than played at the wrong speed.
 * - One retry policy for Gemini across ZARVIS (`ai/geminiErrors.ts`): a transient failure is retried
 *   briefly, a daily quota never; a missing model or an exhausted quota moves to the next TTS model
 *   (TTS quotas are per model). All of that happens before the first byte; sound that has started is
 *   never repeated.
 * - A cancelled request stops the upstream response and is never reported as a failure.
 * - Concurrency is capped (`Semaphore`), and nothing the user said is logged: only the engine, the
 *   voice, the model, sizes and timings. The API key travels in a header, never in a URL or a log.
 */
import { classifyGeminiFailure, retryDelayMs as defaultRetryDelayMs, shouldTryNextModel, toProviderError, type AIProviderError } from "../ai/geminiErrors.js";
import { logger } from "../security/redact.js";
import { Semaphore } from "./guard.js";
import { TtsProviderError, abortError, isAbortError, sleep, type TtsOptions, type TtsProvider } from "./provider.js";
import { speakableText } from "./ssml.js";
import { detectSpeechLanguage } from "./voices.js";
import { TTS_SAMPLE_RATE, pcmToWav } from "./wav.js";

/** The prebuilt voices a caller may ask for by name; anything else is ignored and the configured voice speaks. */
export const GEMINI_TTS_VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir"] as const;
export const DEFAULT_GEMINI_TTS_VOICE = "Kore";
export const DEFAULT_GEMINI_TTS_MODEL = "gemini-3.8-flash-lite-tts";

/** Reported as the voice name (`X-Zarvis-TTS-Voice`), so a Gemini voice can never be taken for an Edge one. */
export function geminiVoiceLabel(voice: string): string {
  return `gemini:${voice}`;
}

export interface GeminiTtsProviderOptions {
  /** The key, or a function that reads it when a request is made (so a rotated key is picked up). */
  apiKey: string | undefined | (() => string | undefined);
  /** The first model to try; the other known TTS models follow it. */
  model: string;
  /** The voice that speaks when the caller names none. */
  voice: string;
  baseUrl?: string;
  /** The wire. Production uses `fetch`; tests pass a fake. */
  fetchImpl?: typeof fetch;
  /** How long to wait for the response headers of one try (default 60 s). */
  timeoutMs?: number;
  maxConcurrent?: number;
  maxQueued?: number;
  /** Longest text one call accepts (default 4000 characters), a limit behind the route's own. */
  maxTextChars?: number;
  /** The wait before retrying the same model, or `null` to stop (default: the shared Gemini policy). */
  retryDelayMs?: typeof defaultRetryDelayMs;
  now?: () => number;
}

interface GeminiTtsResponse {
  candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
}

const EXTRA_TTS_MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];

export class GeminiTtsProvider implements TtsProvider {
  readonly id = "gemini";

  private readonly slots: Semaphore;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxTextChars: number;
  private readonly retryDelayMs: typeof defaultRetryDelayMs;
  private readonly now: () => number;

  constructor(private readonly options: GeminiTtsProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxTextChars = options.maxTextChars ?? 4000;
    this.retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
    this.now = options.now ?? Date.now;
    this.slots = new Semaphore(options.maxConcurrent ?? 8, options.maxQueued ?? 16);
  }

  getDefaultVoice(): string {
    return geminiVoiceLabel(this.options.voice);
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
    const voice = this.pickVoice(options.voice);
    options.onResolved?.({ voice: geminiVoiceLabel(voice), language: detectSpeechLanguage(prepared), engine: this.id });
    if (signal?.aborted) throw abortError();
    const key = typeof this.options.apiKey === "function" ? this.options.apiKey() : this.options.apiKey;
    if (!key) throw new TtsProviderError("No Gemini API key is configured for the voice", "REJECTED", false);

    const release = await this.slots.acquire(signal);
    const started = this.now();
    try {
      const { response, model } = await this.send(prepared, voice, key, signal);
      let pcmBytes = 0;
      for await (const pcm of this.readPcm(response, signal)) {
        pcmBytes += pcm.length;
        yield pcm;
      }
      if (pcmBytes === 0) throw new TtsProviderError("The voice service finished without producing sound", "NO_AUDIO", false);
      logger.info("TTS call", { engine: this.id, voice, model, chars: prepared.length, pcmBytes, totalMs: this.now() - started });
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

  private pickVoice(requested: unknown): string {
    // A caller's Edge voice name (or anything unknown) is ignored: the configured Gemini voice speaks.
    if (typeof requested === "string" && (GEMINI_TTS_VOICES as readonly string[]).includes(requested)) return requested;
    return this.options.voice;
  }

  private candidateModels(): string[] {
    return [this.options.model, ...EXTRA_TTS_MODELS].map((model) => model.trim()).filter((model, index, all) => model && all.indexOf(model) === index);
  }

  private requestBody(text: string, voice: string): string {
    return JSON.stringify({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    });
  }

  /**
   * One logical request, with the retry policy of `ai/geminiErrors.ts`: a daily quota is not retried,
   * a missing model or an exhausted quota moves on to the next TTS model, a transient failure backs
   * off briefly. Returns the first response that is OK; every failure leaves as a `TtsProviderError`.
   */
  private async send(text: string, voice: string, key: string, signal?: AbortSignal): Promise<{ response: Response; model: string }> {
    const body = this.requestBody(text, voice);
    let lastError: TtsProviderError | undefined;
    for (const model of this.candidateModels()) {
      const url = `${this.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
      for (let attempt = 0; ; attempt += 1) {
        if (signal?.aborted) throw abortError();
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
        let response: Response;
        try {
          response = await this.fetchImpl(url, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": key },
            body,
            signal: signal ? AbortSignal.any([timeout.signal, signal]) : timeout.signal,
          });
        } catch (error) {
          if (signal?.aborted || (isAbortError(error) && !timeout.signal.aborted)) throw abortError();
          const timedOut = timeout.signal.aborted;
          lastError = new TtsProviderError(
            timedOut ? "The Gemini voice did not answer in time" : "Could not reach the Gemini voice service",
            timedOut ? "TIMEOUT" : "UNAVAILABLE",
            true,
            { cause: error },
          );
          // A service that is slow is not made faster by asking again, and another model is no nearer
          // than this one when the network itself is down: both end here instead of spending more time.
          if (timedOut) throw lastError;
          const wait = this.retryDelayMs({ kind: "transient" }, attempt);
          if (wait === null) throw lastError;
          await sleep(wait, signal);
          continue;
        } finally {
          clearTimeout(timer);
        }
        if (response.ok) {
          if (model !== this.candidateModels()[0]) logger.warn("Gemini voice answered with a fallback model", { configuredModel: this.candidateModels()[0], servedModel: model });
          return { response, model };
        }

        const detail = await response.text().catch(() => "");
        const failure = classifyGeminiFailure(response.status, detail, response.headers.get("retry-after"));
        const providerError = toProviderError("Gemini voice", response.status, response.statusText, failure, detail, model);
        lastError = toTtsError(providerError);
        if (failure.kind === "fatal") throw lastError;
        const wait = this.retryDelayMs(failure, attempt);
        if (wait === null) {
          // TTS quotas are per model, so (unlike chat) an exhausted model is worth moving past.
          if (failure.kind !== "quota" && !shouldTryNextModel(failure)) throw lastError;
          break;
        }
        await sleep(wait, signal);
      }
    }
    throw lastError ?? new TtsProviderError("The Gemini voice failed", "UNAVAILABLE", true);
  }

  /** The SSE answer as 16-bit mono PCM at 24 kHz, in order, never splitting a sample between two chunks. */
  private async *readPcm(response: Response, signal?: AbortSignal): AsyncGenerator<Buffer> {
    if (!response.body) throw new TtsProviderError("The Gemini voice answered with no body", "NO_AUDIO", false);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let carry: Buffer | undefined;
    const parse = (line: string): Buffer[] => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return [];
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") return [];
      let json: GeminiTtsResponse;
      try {
        json = JSON.parse(payload) as GeminiTtsResponse;
      } catch (error) {
        throw new TtsProviderError("The Gemini voice sent an answer that cannot be read", "BAD_AUDIO", false, { cause: error });
      }
      const out: Buffer[] = [];
      for (const part of json.candidates?.[0]?.content?.parts ?? []) {
        const inline = part.inlineData;
        if (!inline?.data) continue;
        const rate = /rate=(\d+)/i.exec(inline.mimeType ?? "")?.[1];
        if (rate && Number(rate) !== TTS_SAMPLE_RATE) {
          throw new TtsProviderError(`The Gemini voice sent audio at ${rate} Hz, not ${TTS_SAMPLE_RATE} Hz`, "BAD_AUDIO", false);
        }
        out.push(Buffer.from(inline.data, "base64"));
      }
      return out;
    };
    const align = (chunk: Buffer): Buffer | undefined => {
      const joined = carry ? Buffer.concat([carry, chunk]) : chunk;
      carry = undefined;
      const usable = joined.length - (joined.length % 2);
      if (usable < joined.length) carry = joined.subarray(usable);
      return usable > 0 ? joined.subarray(0, usable) : undefined;
    };
    try {
      while (true) {
        if (signal?.aborted) throw abortError();
        let read: Awaited<ReturnType<typeof reader.read>>;
        try {
          read = await reader.read();
        } catch (error) {
          if (signal?.aborted || isAbortError(error)) throw abortError();
          throw new TtsProviderError("The Gemini voice stream was cut off", "UNAVAILABLE", true, { cause: error });
        }
        if (read.done) break;
        buffer += decoder.decode(read.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) for (const chunk of parse(line)) {
          const aligned = align(chunk);
          if (aligned) yield aligned;
        }
      }
      for (const chunk of parse(buffer)) {
        const aligned = align(chunk);
        if (aligned) yield aligned;
      }
    } finally {
      // Also runs when the consumer stops early (the client went away): cancel the upstream response.
      await reader.cancel().catch(() => undefined);
    }
  }
}

/** A Gemini failure as the voice boundary names it. The service's own words stay in `cause`, never in the message. */
function toTtsError(error: AIProviderError): TtsProviderError {
  const options = { cause: error, retryAfterMs: error.retryAfterMs };
  if (error.code === "AI_QUOTA_EXCEEDED") return new TtsProviderError("The Gemini voice has used up its quota", "UNAVAILABLE", false, options);
  if (error.code === "AI_RATE_LIMITED") return new TtsProviderError("The Gemini voice is rate limited", "UNAVAILABLE", true, options);
  // 5xx and 408 are the service's trouble, retryable; any other refusal (a rejected key, a bad request, a missing model) is not.
  if (error.status >= 500 || error.status === 408) return new TtsProviderError("The Gemini voice is unavailable", "UNAVAILABLE", true, options);
  return new TtsProviderError(`The Gemini voice refused the request (HTTP ${error.status})`, "REJECTED", false, options);
}
