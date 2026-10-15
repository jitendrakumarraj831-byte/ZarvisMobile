import { describe, expect, it } from "vitest";
import { Mp3PcmDecoder, floatToPcm16 } from "../../src/tts/mp3Decoder.js";
import { TtsProviderError } from "../../src/tts/provider.js";
import { FIXTURE_FRAMES, SAMPLES_PER_FRAME, edgeLikeMp3, pieces, wrongRateMp3 } from "./helpers.js";

async function decodeAll(chunks: Buffer[]): Promise<{ pcm: Buffer; decoded: number }> {
  const decoder = await Mp3PcmDecoder.create();
  try {
    const out = chunks.map((chunk) => decoder.push(chunk));
    return { pcm: Buffer.concat(out), decoded: decoder.decodedSamples };
  } finally {
    decoder.close();
  }
}

describe("Mp3PcmDecoder: the Edge MP3 becomes ZARVIS audio", () => {
  it("decodes the service's 24 kHz mono MP3 to 16-bit PCM of the right length", async () => {
    const { pcm, decoded } = await decodeAll([edgeLikeMp3()]);
    expect(pcm.length % 2).toBe(0);
    // Every 24 kHz Layer III frame is 576 samples; a stream with no Xing header is not trimmed.
    expect(decoded).toBe(FIXTURE_FRAMES * SAMPLES_PER_FRAME);
    expect(pcm.length / 2).toBe(decoded);
    expect(pcm.length / 2 / 24_000).toBeCloseTo(1.248, 2);
  });

  it("produces the sound that was encoded: the fixture's 330 Hz tone, after the encoder's short lead-in", async () => {
    const { pcm } = await decodeAll([edgeLikeMp3()]);
    const samples = pcm.length / 2;
    let peak = 0;
    let firstLoud = -1;
    let lastLoud = -1;
    let cycles = 0;
    let state = 0; // a crossing counts only from below -300 to above +300, so near-silent noise is not a cycle
    for (let i = 0; i < samples; i += 1) {
      const sample = pcm.readInt16LE(i * 2);
      peak = Math.max(peak, Math.abs(sample));
      if (Math.abs(sample) > 300) {
        if (firstLoud < 0) firstLoud = i;
        lastLoud = i;
      }
      if (sample > 300) {
        if (state < 0) cycles += 1;
        state = 1;
      } else if (sample < -300) {
        state = -1;
      }
    }
    // ffmpeg's sine source is at 1/8 of full scale; the fixture halves it again: about 2000 of 32767.
    expect(peak).toBeGreaterThan(1500);
    expect(peak).toBeLessThan(2600);
    // A stream with no Xing header is not trimmed, so the encoder's delay (about 46 ms) is audible silence.
    expect(firstLoud / 24).toBeGreaterThan(30);
    expect(firstLoud / 24).toBeLessThan(70);
    const toneSeconds = (lastLoud - firstLoud) / 24_000;
    expect(toneSeconds).toBeCloseTo(1.2, 1);
    expect(cycles / toneSeconds).toBeGreaterThan(320);
    expect(cycles / toneSeconds).toBeLessThan(340);
  });

  it("gives the same audio however the network splits the MP3, down to one byte at a time", async () => {
    const whole = (await decodeAll([edgeLikeMp3()])).pcm;
    for (const size of [1, 7, 144, 417, 1000, 4096]) {
      const split = (await decodeAll(pieces(edgeLikeMp3(), size))).pcm;
      expect(split.equals(whole), `chunk size ${size}`).toBe(true);
    }
  });

  it("returns nothing for a push that does not complete a frame, and the audio on the push that does", async () => {
    const decoder = await Mp3PcmDecoder.create();
    try {
      const mp3 = edgeLikeMp3();
      expect(decoder.push(mp3.subarray(0, 50)).length).toBe(0);
      expect(decoder.push(mp3.subarray(50, 600)).length).toBeGreaterThan(0);
    } finally {
      decoder.close();
    }
  });

  it("refuses audio at another sample rate instead of playing it at the wrong speed", async () => {
    const decoder = await Mp3PcmDecoder.create();
    try {
      let thrown: unknown;
      try {
        decoder.push(wrongRateMp3());
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TtsProviderError);
      expect(thrown).toMatchObject({ kind: "BAD_AUDIO", retryable: false });
      expect((thrown as Error).message).toMatch(/48000 Hz/);
    } finally {
      decoder.close();
    }
  });

  it("decodes nothing from bytes that are not MP3, so the caller can tell the audio was unusable", async () => {
    const garbage = Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 37 + 11) % 251));
    const { pcm, decoded } = await decodeAll(pieces(garbage, 500));
    expect(pcm.length).toBe(0);
    expect(decoded).toBe(0);
    const text = await decodeAll([Buffer.from("HTTP/1.1 403 Forbidden\r\nContent-Type: text/html\r\n\r\n<html>denied</html>")]);
    expect(text.decoded).toBe(0);
  });

  it("recovers after damage in the middle of a stream and decodes what follows", async () => {
    const mp3 = Buffer.from(edgeLikeMp3());
    for (let i = 1000; i < 1300; i += 1) mp3[i] = 0x55; // wreck a few frames
    const { decoded } = await decodeAll(pieces(mp3, 900));
    expect(decoded).toBeGreaterThan(FIXTURE_FRAMES * SAMPLES_PER_FRAME * 0.6);
    expect(decoded).toBeLessThanOrEqual(FIXTURE_FRAMES * SAMPLES_PER_FRAME);
  });

  it("starts a new stream after reset, with nothing left over from the last one", async () => {
    const decoder = await Mp3PcmDecoder.create();
    try {
      const first = decoder.push(edgeLikeMp3());
      expect(decoder.decodedSamples).toBe(FIXTURE_FRAMES * SAMPLES_PER_FRAME);
      await decoder.reset();
      expect(decoder.decodedSamples).toBe(0);
      const second = decoder.push(edgeLikeMp3());
      expect(second.equals(first)).toBe(true);
    } finally {
      decoder.close();
    }
  });

  it("can be closed twice, and refuses work once closed", async () => {
    const decoder = await Mp3PcmDecoder.create();
    decoder.close();
    expect(() => decoder.close()).not.toThrow();
    expect(() => decoder.push(edgeLikeMp3())).toThrow(/closed/);
    await expect(decoder.reset()).rejects.toThrow(/closed/);
  });

  it("keeps independent decoders independent when they run at the same time", async () => {
    const mp3 = edgeLikeMp3();
    const results = await Promise.all([1, 3, 500, 2048].map((size) => decodeAll(pieces(mp3, size))));
    for (const result of results) expect(result.pcm.equals(results[0]!.pcm)).toBe(true);
  });
});

describe("floatToPcm16", () => {
  it("scales, rounds and clips to 16-bit little-endian", () => {
    const pcm = floatToPcm16([Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2])], 7);
    expect([...Array(7).keys()].map((i) => pcm.readInt16LE(i * 2))).toEqual([0, 16384, -16383, 32767, -32767, 32767, -32767]); // Math.round rounds -16383.5 up
  });

  it("averages channels to mono", () => {
    const pcm = floatToPcm16([Float32Array.from([1, 0]), Float32Array.from([0, 0.5])], 2);
    expect(pcm.readInt16LE(0)).toBe(16384);
    expect(pcm.readInt16LE(2)).toBe(8192);
  });
});
