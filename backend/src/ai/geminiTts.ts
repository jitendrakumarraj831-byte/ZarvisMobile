/**
 * Gemini 3.8 Flash TTS provider. Gemini is the ONLY voice provider used by Zarvis.
 * Transient Google API failures are retried so the UI never silently changes voice engines.
 */
export class GeminiTtsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly voiceName: string,
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta",
  ) {}

  async synthesize(text: string): Promise<Buffer> {
    const url = this.baseUrl + "/models/" + encodeURIComponent(this.model) + ":generateContent";
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        // Streaming TTS must stay explicitly on headerless 24 kHz PCM. Gemini's
        // streaming GenerateContent endpoint returns AUDIO_L16 by default, but
        // declaring it here prevents a future API/model default from silently
        // changing the browser playback contract.
        responseFormat: {
          audio: {
            mimeType: "AUDIO_L16",
            sampleRate: 24000,
          },
        },
        speechConfig: { voiceConfig: { voice: this.voiceName } },
      },
    });

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
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
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
    throw lastError ?? new Error("Gemini TTS failed");
  }
  /** Streams headerless 24 kHz mono 16-bit little-endian PCM chunks for browser playback. */
  async *streamSynthesize(text: string): AsyncIterable<Buffer> {
    const url = this.baseUrl + "/models/" + encodeURIComponent(this.model) + ":streamGenerateContent?alt=sse";
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { voice: this.voiceName } },
      },
    });

    // Streaming calls can still hit transient 429/5xx responses. Retry only before
    // the first audio byte is received; never restart after playback has begun.
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
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
            await new Promise((resolve) => setTimeout(resolve, 350 * 2 ** attempt));
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
        await new Promise((resolve) => setTimeout(resolve, 350 * 2 ** attempt));
      } finally {
        clearTimeout(timer);
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
