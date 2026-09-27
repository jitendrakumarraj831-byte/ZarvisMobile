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
  /** Streams raw 24 kHz mono PCM chunks from Gemini for low-latency browser playback. */
  async *streamSynthesize(text: string): AsyncIterable<Buffer> {
    const url = this.baseUrl + "/models/" + encodeURIComponent(this.model) + ":streamGenerateContent?alt=sse";
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { voice: this.voiceName } },
        responseMimeType: "audio/l16",
      },
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body,
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        throw new Error(("Gemini streaming TTS failed: " + res.status + " " + res.statusText + " " + detail).trim());
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
              if (part.inlineData?.data) yield Buffer.from(part.inlineData.data, "base64");
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

interface GeminiTtsResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ inlineData?: { data: string; mimeType?: string } }>;
    };
  }>;
}
