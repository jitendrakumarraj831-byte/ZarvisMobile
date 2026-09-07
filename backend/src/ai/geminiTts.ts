/**
 * Gemini native-audio-output voice — the same underlying voice model family behind the
 * Gemini app's voice mode, called as a plain `generateContent` request (no WebSocket/Live
 * API session needed for a one-shot "speak this reply" use case). This is a distinct
 * capability from `geminiProvider.ts`'s text generation, but the same `GEMINI_API_KEY` and
 * the same Generative Language API — not the separate Google Cloud Text-to-Speech product,
 * which would need its own credential. See AI_ARCHITECTURE.md "Native audio voice" and
 * DEVELOPMENT.md "Voice quality".
 */
export class GeminiTtsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly voiceName: string,
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta",
  ) {}

  /** Returns a playable WAV file (Gemini returns raw PCM; browsers can't play that directly). */
  async synthesize(text: string): Promise<Buffer> {
    const res = await fetch(`${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voiceName } } },
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini TTS failed: ${res.status} ${res.statusText} ${errText}`.trim());
    }
    const json = (await res.json()) as GeminiTtsResponse;
    const part = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!part?.data) {
      throw new Error("Gemini TTS returned no audio data");
    }
    const pcm = Buffer.from(part.data, "base64");
    const sampleRate = parseSampleRate(part.mimeType) ?? 24000;
    return pcmToWav(pcm, sampleRate, 1, 16);
  }
}

interface GeminiTtsResponse {
  candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string; mimeType?: string } }> } }>;
}

/** Gemini reports the real sample rate in the part's mimeType, e.g. "audio/L16;rate=24000". */
function parseSampleRate(mimeType?: string): number | undefined {
  const match = mimeType?.match(/rate=(\d+)/);
  return match?.[1] ? Number(match[1]) : undefined;
}

/** Node has no built-in WAV encoder; this is just the standard 44-byte PCM WAV header. */
function pcmToWav(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
