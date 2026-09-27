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
}

interface GeminiTtsResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ inlineData?: { data: string; mimeType?: string } }>;
    };
  }>;
}
