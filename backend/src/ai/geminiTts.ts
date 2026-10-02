/**
 * Gemini native-audio TTS provider (the only voice provider used by ZARVIS).
 *
 * Request shape follows Google's documented Gemini API speech-generation contract:
 * `generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`. Gemini returns
 * raw 16-bit little-endian mono PCM (typically `audio/L16;codec=pcm;rate=24000`); `synthesize`
 * wraps that in a WAV header so every client can play it with a standard media player, and
 * passes real WAV through unchanged.
 *
 * Retry policy (ai/geminiErrors.ts): transient 408/5xx are retried with a short backoff, a
 * per-minute 429 at most once, a daily-quota 429 never; 404 (model not available to this
 * project) moves to the next candidate model; any other 4xx is thrown immediately.
 */
import { abortError, classifyGeminiFailure, retryDelayMs, shouldTryNextModel, sleep, toProviderError } from "./geminiErrors.js";
import { logger } from "../security/redact.js";

export const GEMINI_TTS_VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir"] as const;

const DEFAULT_PCM_SAMPLE_RATE = 24000;

export function resolveGeminiVoice(requested: unknown, fallback: string): string {
  return typeof requested === "string" && (GEMINI_TTS_VOICES as readonly string[]).includes(requested)
    ? requested
    : fallback;
}

export function speechConfigFor(voiceName: string) {
  return { voiceConfig: { prebuiltVoiceConfig: { voiceName } } };
}

/** Parses `rate=NNNN` from an `audio/L16;...` mime type. */
export function pcmSampleRate(mimeType: string | undefined): number {
  const match = mimeType?.match(/rate=(\d+)/i);
  const rate = match ? Number(match[1]) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_PCM_SAMPLE_RATE;
}

/** Wraps mono 16-bit PCM in a 44-byte RIFF/WAVE header. */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2;
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format: PCM
  header.writeUInt16LE(1, 22); // channels: mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class GeminiTtsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly voiceName: string,
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta",
  ) {}

  private candidateModels(): string[] {
    return [this.model, "gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]
      .map((model) => model.trim())
      .filter((model, index, all) => model && all.indexOf(model) === index);
  }

  get defaultVoice(): string {
    return this.voiceName;
  }

  /** Returns a playable WAV file. */
  async synthesize(text: string, voiceName = this.voiceName): Promise<Buffer> {
    const res = await this.send(this.requestBody(text, voiceName), "generateContent", "Gemini TTS");
    const json = (await res.json()) as GeminiTtsResponse;
    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!part?.data) throw new Error("Gemini TTS returned no audio data");
    const audio = Buffer.from(part.data, "base64");
    const mime = part.mimeType?.toLowerCase() ?? "";
    if (mime.includes("wav") || audio.subarray(0, 4).toString("ascii") === "RIFF") return audio;
    return pcmToWav(audio, pcmSampleRate(part.mimeType));
  }

  /** Streams headerless 16-bit little-endian mono PCM chunks (24 kHz) for browser playback.
   * Retries happen only before the first audio byte; playback that began is never restarted. */
  async *streamSynthesize(text: string, voiceName = this.voiceName, signal?: AbortSignal): AsyncIterable<Buffer> {
    const res = await this.send(this.requestBody(text, voiceName), "streamGenerateContent?alt=sse", "Gemini streaming TTS", signal);
    if (!res.body) throw new Error("Gemini streaming TTS returned no body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const emit = function* (line: string): Generator<Buffer> {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      const json = JSON.parse(payload) as GeminiTtsResponse;
      for (const part of json.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) yield Buffer.from(part.inlineData.data, "base64");
      }
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) yield* emit(line);
      }
      yield* emit(buffer);
    } finally {
      // Also runs when the consumer stops early (client disconnected): cancel the upstream
      // response instead of letting it download audio nobody will hear.
      await reader.cancel().catch(() => {});
    }
  }

  private requestBody(text: string, voiceName: string): string {
    return JSON.stringify({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: speechConfigFor(resolveGeminiVoice(voiceName, this.voiceName)),
      },
    });
  }

  /** One logical TTS request with the shared policy in ai/geminiErrors.ts: a daily quota is
   * not retried, a 404 moves to the next candidate model, transient errors back off briefly. */
  private async send(body: string, method: string, label: string, signal?: AbortSignal): Promise<Response> {
    let lastError: Error | undefined;
    for (const model of this.candidateModels()) {
      const url = this.baseUrl + "/models/" + encodeURIComponent(model) + ":" + method;
      for (let attempt = 0; ; attempt += 1) {
        if (signal?.aborted) throw abortError();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120_000);
        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
            body,
            signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
          });
        } catch (error) {
          if (signal?.aborted) throw abortError();
          lastError = error instanceof Error && error.name === "AbortError" ? new Error(label + " request timed out") : error instanceof Error ? error : new Error(String(error));
          const wait = retryDelayMs({ kind: "transient" }, attempt);
          if (wait === null) break;
          await sleep(wait, signal);
          continue;
        } finally {
          clearTimeout(timer);
        }
        if (res.ok) {
          const configured = this.candidateModels()[0];
          if (model !== configured) logger.warn("Gemini TTS answered with a fallback model", { configuredModel: configured, servedModel: model, label });
          return res;
        }

        const detail = await res.text().catch(() => "");
        const failure = classifyGeminiFailure(res.status, detail, res.headers.get("retry-after"));
        lastError = toProviderError(label, res.status, res.statusText, failure, detail);
        if (failure.kind === "fatal") throw lastError;
        const wait = retryDelayMs(failure, attempt);
        if (wait === null) {
          if (!shouldTryNextModel(failure)) throw lastError;
          break;
        }
        await sleep(wait, signal);
      }
    }
    throw lastError ?? new Error(label + " failed");
  }
}

interface GeminiTtsResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ inlineData?: { data: string; mimeType?: string } }>;
    };
  }>;
}
