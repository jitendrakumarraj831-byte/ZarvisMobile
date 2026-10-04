/**
 * MP3 in, ZARVIS audio out.
 *
 * The Edge voice service answers in MP3 (24 kHz, 48 kbit/s, mono): it offers no PCM output. The
 * web client plays headerless 24 kHz 16-bit mono PCM, and Android plays a WAV file, so the audio is
 * decoded here, on the server, as it arrives. `mpg123-decoder` is mpg123 compiled to WebAssembly:
 * no native module, no system binary, nothing to install on the host, and it keeps the partial
 * frame between pushes, so the MP3 can be fed in whatever pieces the network delivers.
 *
 * Nothing is guessed: audio at another sample rate than 24 kHz is refused instead of being played
 * at the wrong speed, and a stream that never decodes to a single sample is an error.
 */
import type { MPEGDecoder } from "mpg123-decoder";
import { TtsProviderError } from "./provider.js";
import { TTS_SAMPLE_RATE } from "./wav.js";

/** Float samples in [-1, 1] (one array per channel, averaged to mono) as 16-bit little-endian PCM. */
export function floatToPcm16(channels: readonly Float32Array[], count: number): Buffer {
  const out = Buffer.allocUnsafe(count * 2);
  const width = channels.length;
  for (let i = 0; i < count; i += 1) {
    let sum = 0;
    for (let c = 0; c < width; c += 1) sum += channels[c]![i] ?? 0;
    const mono = Math.max(-1, Math.min(1, sum / width));
    out.writeInt16LE(Math.round(mono * 32767), i * 2);
  }
  return out;
}

export class Mp3PcmDecoder {
  private decoder: MPEGDecoder | undefined;
  private decoded = 0;

  private constructor(decoder: MPEGDecoder) {
    this.decoder = decoder;
  }

  static async create(): Promise<Mp3PcmDecoder> {
    let decoder: MPEGDecoder;
    try {
      // Loaded on first use, so the requests that never speak do not pay for it at start-up.
      const { MPEGDecoder: Decoder } = await import("mpg123-decoder");
      decoder = new Decoder();
      await decoder.ready;
    } catch (error) {
      throw new TtsProviderError("The audio decoder could not start", "BAD_AUDIO", false, { cause: error });
    }
    return new Mp3PcmDecoder(decoder);
  }

  /** Samples decoded since the last `reset`. Zero after a whole answer means the audio was unusable. */
  get decodedSamples(): number {
    return this.decoded;
  }

  /** The PCM that `mp3` completes (possibly none: a frame can be split across pushes). */
  push(mp3: Uint8Array): Buffer {
    const decoder = this.decoder;
    if (!decoder) throw new Error("The audio decoder is closed");
    let result: ReturnType<MPEGDecoder["decode"]>;
    try {
      result = decoder.decode(mp3);
    } catch (error) {
      throw new TtsProviderError("The voice service sent audio that could not be decoded", "BAD_AUDIO", false, { cause: error });
    }
    if (result.samplesDecoded === 0) return Buffer.alloc(0);
    if (result.sampleRate !== TTS_SAMPLE_RATE) {
      throw new TtsProviderError(`The voice service sent ${result.sampleRate} Hz audio; ZARVIS plays ${TTS_SAMPLE_RATE} Hz`, "BAD_AUDIO", false);
    }
    this.decoded += result.samplesDecoded;
    return floatToPcm16(result.channelData, result.samplesDecoded);
  }

  /** Starts a new MP3 stream (the next text part) with no leftover from the last one. */
  async reset(): Promise<void> {
    if (!this.decoder) throw new Error("The audio decoder is closed");
    await this.decoder.reset();
    this.decoded = 0;
  }

  /** Frees the decoder's memory. Safe to call more than once. */
  close(): void {
    const decoder = this.decoder;
    this.decoder = undefined;
    decoder?.free();
  }
}
