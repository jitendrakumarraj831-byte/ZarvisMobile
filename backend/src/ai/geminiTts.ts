/**
 * Gemini 3.8 Flash TTS provider. Gemini is the ONLY voice provider used by Zarvis.
 * Transient Google API failures are retried so the UI never silently changes voice engines.
 */
export const GEMINI_TTS_VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir"] as const;

export function resolveGeminiVoice(requested: unknown, fallback: string): string {
  return typeof requested === "string" && (GEMINI_TTS_VOICES as readonly string[]).includes(requested)
    ? requested
    : fallback;
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

  async synthesize(text: string, voiceName = this.voiceName): Promise<Buffer> {
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { voice: resolveGeminiVoice(voiceName, this.voiceName) } },
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
          if (!part?.data) throw new Error("Gemini TTS returned no audio data");
          // Gemini 3.8 Flash TTS unary generation returns audio/wav directly.
          return Buffer.from(part.data, "base64");
        }

        const errText = await res.text().catch(() => "");
        lastError = new Error(("Gemini TTS failed: " + res.status + " " + res.statusText + " " + errText).trim());
        if (![408, 429, 500, 502, 503, 504].includes(res.status)) break;
      } catch (error) {
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
  /** Streams headerless 24 kHz mono 16-bit little-endian PCM chunks for browser playback. */
  async *streamSynthesize(text: string, voiceName = this.voiceName): AsyncIterable<Buffer> {
    const models = this.candidateModels();
    const voice = resolveGeminiVoice(voiceName, this.voiceName);
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        // Streaming TTS is consumed as raw 24 kHz PCM in the browser. Keep this
        // explicit so the server/client audio contract cannot silently change.
        responseFormat: {
          audio: {
            mimeType: "AUDIO_L16",
            sampleRate: 24000,
          },
        },
        speechConfig: { voiceConfig: { voice } },
      },
    });

    // Streaming calls can still hit transient 429/5xx responses. Retry only before
    // the first audio byte is received; never restart after playback has begun.
    let lastError: Error | undefined;
    for (const model of models) {
      const url = this.baseUrl + "/models/" + encodeURIComponent(model) + ":streamGenerateContent?alt=sse";
      for (let attempt = 0; attempt < 3; attempt += 1) {
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
          lastError = new Error(("Gemini streaming TTS failed: " + res.status + " " + res.statusText + " " + detail).trim());
          if (![408, 429, 500, 502, 503, 504].includes(res.status)) throw lastError;
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt + Math.floor(Math.random() * 250)));
            continue;
          }
          throw lastError;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const payload = trimmed.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              const json = JSON.parse(payload) as GeminiTtsResponse;
              const parts = json.candidates?.[0]?.content?.parts ?? [];
              for (const part of parts) {
                if (part.inlineData?.data) {
                  started = true;
                  yield Buffer.from(part.inlineData.data, "base64");
                }
              }
            }
          }
          // Flush a final SSE line that did not end in a newline.
          if (buffer.trim().startsWith("data:")) {
            const payload = buffer.trim().slice(5).trim();
            if (payload && payload !== "[DONE]") {
              const json = JSON.parse(payload) as GeminiTtsResponse;
              const parts = json.candidates?.[0]?.content?.parts ?? [];
              for (const part of parts) {
                if (part.inlineData?.data) {
                  started = true;
                  yield Buffer.from(part.inlineData.data, "base64");
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
        return;
      } catch (error) {
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
