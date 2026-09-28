/**
 * Gemini native-audio TTS provider (the only voice provider used by ZARVIS).
 *
 * Request shape follows Google's documented Gemini API speech-generation contract:
 * `generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`. Gemini returns
 * raw 16-bit little-endian mono PCM (typically `audio/L16;codec=pcm;rate=24000`); `synthesize`
 * wraps that in a WAV header so every client can play it with a standard media player, and
 * passes real WAV through unchanged.
 *
 * Retry policy: transient 408/429/5xx are retried with backoff; 404 (model not available to
 * this project) moves to the next candidate model; any other 4xx is a permanent request error
 * and is thrown immediately without trying other models.
 */
export const GEMINI_TTS_VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir"] as const;

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
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

class PermanentTtsError extends Error {}

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
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: speechConfigFor(resolveGeminiVoice(voiceName, this.voiceName)),
      },
    });

    let lastError: Error | undefined;
    for (const model of this.candidateModels()) {
      const url = this.baseUrl + "/models/" + encodeURIComponent(model) + ":generateContent";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120_000);
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
            body,
            signal: controller.signal,
          });

          if (res.ok) {
            const json = (await res.json()) as GeminiTtsResponse;
            const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
            if (!part?.data) throw new PermanentTtsError("Gemini TTS returned no audio data");
            const audio = Buffer.from(part.data, "base64");
            const mime = part.mimeType?.toLowerCase() ?? "";
            if (mime.includes("wav") || audio.subarray(0, 4).toString("ascii") === "RIFF") return audio;
            return pcmToWav(audio, pcmSampleRate(part.mimeType));
          }

          const errText = await res.text().catch(() => "");
          lastError = new Error(("Gemini TTS failed: " + res.status + " " + res.statusText + " " + errText.slice(0, 300)).trim());
          if (res.status === 404) break; // model unavailable → next model
          if (!TRANSIENT_STATUSES.has(res.status)) throw new PermanentTtsError(lastError.message);
        } catch (error) {
          if (error instanceof PermanentTtsError) throw new Error(error.message);
          lastError = error instanceof Error ? error : new Error(String(error));
          if (lastError.name === "AbortError") lastError = new Error("Gemini TTS request timed out");
        } finally {
          clearTimeout(timer);
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt + Math.floor(Math.random() * 250)));
        }
      }
    }
    throw lastError ?? new Error("Gemini TTS failed");
  }

  /** Streams headerless 16-bit little-endian mono PCM chunks (24 kHz) for browser playback. */
  async *streamSynthesize(text: string, voiceName = this.voiceName): AsyncIterable<Buffer> {
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: speechConfigFor(resolveGeminiVoice(voiceName, this.voiceName)),
      },
    });

    // Retry only before the first audio byte is received; never restart after playback began.
    let lastError: Error | undefined;
    for (const model of this.candidateModels()) {
      const url = this.baseUrl + "/models/" + encodeURIComponent(model) + ":streamGenerateContent?alt=sse";
      let nextModel = false;
      for (let attempt = 0; attempt < 3 && !nextModel; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120_000);
        let started = false;
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
            body,
            signal: controller.signal,
          });
          if (!res.ok || !res.body) {
            const detail = await res.text().catch(() => "");
            lastError = new Error(("Gemini streaming TTS failed: " + res.status + " " + res.statusText + " " + detail.slice(0, 300)).trim());
            if (res.status === 404) {
              nextModel = true;
              continue;
            }
            if (!TRANSIENT_STATUSES.has(res.status)) throw new PermanentTtsError(lastError.message);
            if (attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt + Math.floor(Math.random() * 250)));
            }
            continue;
          }

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
              for (const line of lines) {
                for (const chunk of emit(line)) {
                  started = true;
                  yield chunk;
                }
              }
            }
            for (const chunk of emit(buffer)) {
              started = true;
              yield chunk;
            }
          } finally {
            reader.releaseLock();
          }
          return;
        } catch (error) {
          if (error instanceof PermanentTtsError) throw new Error(error.message);
          lastError = error instanceof Error ? error : new Error(String(error));
          if (lastError.name === "AbortError") lastError = new Error("Gemini streaming TTS request timed out");
          if (started || attempt >= 2) throw lastError;
          await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt + Math.floor(Math.random() * 250)));
        } finally {
          clearTimeout(timer);
        }
      }
    }
    throw lastError ?? new Error("Gemini streaming TTS failed");
  }
}

interface GeminiTtsResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ inlineData?: { data: string; mimeType?: string } }>;
    };
  }>;
}
