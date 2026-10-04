import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EdgeTransport } from "../../src/tts/edgeTransport.js";
import { TtsProviderError, abortError, sleep, type TtsOptions, type TtsProvider } from "../../src/tts/provider.js";
import type { SpeechLanguage } from "../../src/tts/voices.js";
import { pcmToWav } from "../../src/tts/wav.js";

/**
 * Fixtures: `tone-24khz-mono-48kbps.mp3` is what the Edge service sends (raw MP3 frames, no
 * Xing or ID3 header, 24 kHz, 48 kbit/s, mono); `tone-48khz-mono-64kbps.mp3` is audio at a rate
 * ZARVIS must refuse. Made with:
 *   ffmpeg -f lavfi -i "sine=frequency=330:duration=1.2:sample_rate=24000" -af volume=0.5 -ac 1 \
 *     -ar 24000 -b:a 48k -codec:a libmp3lame -write_xing 0 -id3v2_version 0 -f mp3 out.mp3
 */
const here = dirname(fileURLToPath(import.meta.url));
export const fixture = (name: string): Buffer => readFileSync(join(here, "..", "fixtures", "tts", name));
export const edgeLikeMp3 = (): Buffer => fixture("tone-24khz-mono-48kbps.mp3");
export const wrongRateMp3 = (): Buffer => fixture("tone-48khz-mono-64kbps.mp3");

/** Every MPEG-2 Layer III frame at 24 kHz is 576 samples. */
export const SAMPLES_PER_FRAME = 576;
export const FIXTURE_FRAMES = 52;

/** The network delivers whatever sizes it likes. */
export function pieces(buffer: Buffer, size: number): Buffer[] {
  const out: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += size) out.push(buffer.subarray(offset, Math.min(offset + size, buffer.length)));
  return out;
}

export function parseWav(wav: Buffer): { sampleRate: number; channels: number; bits: number; pcm: Buffer } {
  expectRiff(wav);
  return { sampleRate: wav.readUInt32LE(24), channels: wav.readUInt16LE(22), bits: wav.readUInt16LE(34), pcm: wav.subarray(44, 44 + wav.readUInt32LE(40)) };
}

function expectRiff(wav: Buffer): void {
  if (wav.subarray(0, 4).toString("ascii") !== "RIFF" || wav.subarray(8, 12).toString("ascii") !== "WAVE") throw new Error("not a WAV file");
  if (wav.readUInt32LE(4) !== wav.length - 8) throw new Error("the RIFF size does not match the file");
}

/** 16-bit little-endian PCM at 24 kHz: a stand-in for audio a fake provider "speaks". */
export function pcmTone(seconds: number, frequency = 440, amplitude = 8000): Buffer {
  const samples = Math.round(seconds * 24_000);
  const out = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) out.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / 24_000) * amplitude), i * 2);
  return out;
}

export type TransportStep =
  /** Success: these MP3 chunks, one after another. */
  | { audio: Buffer[]; delayMs?: number }
  /** Yield `afterChunks` (if any), then fail. */
  | { fail: Error; afterChunks?: Buffer[] }
  /** Never answers until it is aborted. */
  | { hang: true };

/** A scripted stand-in for the wire. Records what it was asked and whether each call was cleaned up. */
export class FakeEdgeTransport implements EdgeTransport {
  readonly calls: Array<{ ssml: string; signal?: AbortSignal }> = [];
  /** Calls whose generator ran its `finally` (finished, failed, or abandoned by the consumer). */
  finalized = 0;
  active = 0;
  peakActive = 0;

  constructor(private readonly script: TransportStep[] | ((ssml: string, call: number) => TransportStep)) {}

  async *synthesize(ssml: string, signal?: AbortSignal): AsyncGenerator<Buffer> {
    const call = this.calls.push({ ssml, signal }) - 1;
    const step = typeof this.script === "function" ? this.script(ssml, call) : this.script[Math.min(call, this.script.length - 1)]!;
    this.active += 1;
    this.peakActive = Math.max(this.peakActive, this.active);
    try {
      if ("hang" in step) {
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) reject(abortError());
          signal?.addEventListener("abort", () => reject(abortError()), { once: true });
        });
      } else if ("fail" in step) {
        for (const chunk of step.afterChunks ?? []) yield chunk;
        throw step.fail;
      } else {
        for (const chunk of step.audio) {
          if (signal?.aborted) throw abortError();
          if (step.delayMs) await sleep(step.delayMs, signal);
          yield chunk;
        }
      }
    } finally {
      this.finalized += 1;
      this.active -= 1;
    }
  }
}

export interface FakeProviderBehaviour {
  /** The PCM chunks a stream yields (a unary call returns them as one WAV file). */
  pcm?: Buffer[];
  /** Thrown instead of speaking, or after `errorAfter` chunks of a stream. */
  error?: Error;
  errorAfter?: number;
  delayMs?: number;
  /** Never speaks until the signal aborts. */
  hang?: boolean;
  /** The voice the provider reports through `onResolved`, as the real one does before it speaks. */
  resolved?: { voice: string; language: SpeechLanguage };
}

/** A scripted `TtsProvider` for the route tests. */
export class FakeTtsProvider implements TtsProvider {
  readonly id = "fake";
  readonly calls: Array<{ kind: "unary" | "stream"; text: string; voice: unknown; signal?: AbortSignal }> = [];
  /** Streams whose generator ran its `finally`. */
  finalized = 0;

  constructor(private readonly behaviour: FakeProviderBehaviour = {}) {}

  getDefaultVoice(): string {
    return "fake-voice";
  }

  async synthesize(text: string, options: TtsOptions = {}): Promise<Buffer> {
    this.calls.push({ kind: "unary", text, voice: options.voice, signal: options.signal });
    if (this.behaviour.resolved) options.onResolved?.(this.behaviour.resolved);
    if (this.behaviour.hang) await this.hang(options.signal);
    if (this.behaviour.delayMs) await sleep(this.behaviour.delayMs, options.signal);
    if (this.behaviour.error && !this.behaviour.errorAfter) throw this.behaviour.error;
    return pcmToWav(Buffer.concat(this.behaviour.pcm ?? [pcmTone(0.2)]));
  }

  async *synthesizeStream(text: string, options: TtsOptions = {}): AsyncGenerator<Buffer> {
    this.calls.push({ kind: "stream", text, voice: options.voice, signal: options.signal });
    try {
      if (this.behaviour.resolved) options.onResolved?.(this.behaviour.resolved);
      if (this.behaviour.hang) await this.hang(options.signal);
      if (this.behaviour.error && !this.behaviour.errorAfter) throw this.behaviour.error;
      let sent = 0;
      for (const chunk of this.behaviour.pcm ?? [pcmTone(0.2)]) {
        if (this.behaviour.delayMs) await sleep(this.behaviour.delayMs, options.signal);
        if (this.behaviour.error && this.behaviour.errorAfter !== undefined && sent >= this.behaviour.errorAfter) throw this.behaviour.error;
        sent += 1;
        yield chunk;
      }
    } finally {
      this.finalized += 1;
    }
  }

  private hang(signal?: AbortSignal): Promise<never> {
    return new Promise((_resolve, reject) => {
      if (signal?.aborted) reject(abortError());
      signal?.addEventListener("abort", () => reject(abortError()), { once: true });
    });
  }
}

export const unavailable = (message = "service down") => new TtsProviderError(message, "UNAVAILABLE", true);

/** Three 0.456 s tones (19 frames each) so a test can tell which audio is which. */
export const toneMp3 = (hz: 220 | 440 | 880): Buffer => fixture(`tone-${hz}hz.mp3`);
export const TONE_SAMPLES = 19 * SAMPLES_PER_FRAME;

/** The pitch of a tone in 16-bit PCM at 24 kHz: rising crossings of a threshold at 15% of the peak, over the loud part. */
export function frequencyOf(pcm: Buffer): number {
  const samples = pcm.length / 2;
  let peak = 0;
  for (let i = 0; i < samples; i += 1) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i * 2)));
  const threshold = peak * 0.15;
  let cycles = 0;
  let state = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < samples; i += 1) {
    const sample = pcm.readInt16LE(i * 2);
    if (Math.abs(sample) > threshold) {
      if (first < 0) first = i;
      last = i;
    }
    if (sample > threshold) {
      if (state < 0) cycles += 1;
      state = 1;
    } else if (sample < -threshold) {
      state = -1;
    }
  }
  return cycles / ((last - first) / 24_000);
}

/** Which of the three tones `pcm` is: 220, 440 or 880 Hz (anything else fails the test that asks). */
export function toneOf(pcm: Buffer): 220 | 440 | 880 | undefined {
  const hz = frequencyOf(pcm);
  return ([220, 440, 880] as const).find((candidate) => Math.abs(hz - candidate) / candidate < 0.06);
}
