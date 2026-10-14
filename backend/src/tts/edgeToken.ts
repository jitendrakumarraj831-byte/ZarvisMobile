/**
 * The `Sec-MS-GEC` token, version 2: the value Microsoft's "Read Aloud" speech service wants in the
 * connection URL, next to `Sec-MS-GEC-Version=2-<Edge version>` (see `edgeTransport.ts`).
 *
 * The first version was a plain SHA-256 of the time and the client token, sent with
 * `Sec-MS-GEC-Version=1-...`. The community project moved to this one on 2026-10-13, and from about then
 * this server's Preview answered every connection with HTTP 403 (reported as `REJECTED` / `502 tts_failed`).
 * That the service now refuses version 1 is an inference from those two facts, not something Microsoft has
 * said. The new value is "<16 hex>-<64 hex>": a CS64 digest and a SHA-256 digest of the same text.
 *
 * Provenance. This is a port to TypeScript of `generate_sec_ms_gec_v2` and the functions under it in
 * `src/edge_tts/drm.py` of the community project https://github.com/rany2/edge-tts, which is licensed
 * under the GNU LGPL v3 (https://www.gnu.org/licenses/lgpl-3.0.html) and was read on 2026-10-14. The
 * constants and the order of the operations are the ones in that file; nothing here is original
 * cryptography, and no attempt is made to explain why the service wants it. This file is therefore a
 * derivative of LGPL-3.0 code: keep this notice with it. This repository is public, so the source of this
 * file is already available to anyone; THIRD_PARTY_NOTICES.md records what upstream's licence says, what
 * the repository does about it and what is not settled, and LICENSES/ holds the LGPL-3.0 and GPL-3.0 texts.
 *
 * How it is checked. `test/tts/edgeToken.test.ts` holds tokens that the upstream Python function produced
 * for fixed times (the file's own `generate_sec_ms_gec_v2`, run unmodified); this port gave the same token
 * for all of 412 times, spread over four years, when it was written. What cannot be checked from here is
 * that the live service accepts it today: the live smoke test and the browser audit say so on a Preview.
 *
 * Arithmetic. Everything is 32-bit modular, so `Math.imul(a, b) >>> 0` is the low 32 bits of `a * b`, and
 * a sum of a few 32-bit numbers (below 2^53) is exact before it is taken modulo 2^32 with `>>> 0`. The
 * Python original keeps some intermediate values unmasked (rotations by multiplying with 2^32 + 1); only
 * their low 32 bits ever reach the result, so the masked form below is the same computation.
 */

const WIN_EPOCH_SECONDS = 11_644_473_600;
/** One tick is 100 ns. */
const TICKS_PER_SECOND = 10_000_000n;

// FIPS 180-4 initial hash values, then the state and schedule words that the original resumes from.
const SHA256_INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const SHA256_STATE = [0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2];
const SHA256_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6, 0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33,
  0xd258b060, 0x72766564,
];
const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const SHA256_ADJUSTMENT = 0xc9dc06a7;
/** Round 14 uses the adjusted constant when the compression is resumed inside the first block. */
const SHA256_BLOCK_CONSTANTS = [...SHA256_ROUND_CONSTANTS.slice(0, 14), SHA256_ADJUSTMENT, ...SHA256_ROUND_CONSTANTS.slice(15)];
const SHA256_SIGMA0_ADJUSTMENT = 0x059c0b80;
const SHA256_SIGMA1_ADJUSTMENT = 0x000b92c0;

/** [coefficient, offset] pairs. */
const CS64_COEFFICIENTS: ReadonlyArray<readonly [number, number]> = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

/** The low 32 bits of a product. */
const mul = (a: number, b: number): number => Math.imul(a, b) >>> 0;
/** A 32-bit rotation left by 16. */
const rol16 = (value: number): number => ((value << 16) | (value >>> 16)) >>> 0;
const sigma0 = (value: number): number => ((value >>> 7) ^ (value << 25) ^ (value >>> 18) ^ (value << 14) ^ (value >>> 3)) >>> 0;
const sigma1 = (value: number): number => ((value >>> 17) ^ (value << 15) ^ (value >>> 19) ^ (value << 13) ^ (value >>> 10)) >>> 0;
const rotr = (value: number, bits: number): number => ((value >>> bits) | (value << (32 - bits))) >>> 0;

/** Little-endian 32-bit words, zero-padded to a whole word and to an even count of words. */
function wordsLittleEndianEven(data: Buffer): number[] {
  const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  const words: number[] = [];
  for (let offset = 0; offset < padded.length; offset += 4) words.push(padded.readUInt32LE(offset));
  if (words.length % 2) words.push(0);
  return words;
}

/** SHA-256 compression rounds `firstRound` to 63 over the schedule `words`; returns the working variables a..h. */
function sha256Rounds(state: readonly number[], words: readonly number[], firstRound = 0): number[] {
  let [a, b, c, d, e, f, g, h] = state as [number, number, number, number, number, number, number, number];
  const constants = firstRound === 14 ? SHA256_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS;
  for (let index = firstRound; index < 64; index += 1) {
    const t1 = h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + (g ^ (e & (f ^ g))) + constants[index]! + words[index]!;
    const t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) | (c & (a | b)));
    h = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  return [a, b, c, d, e, f, g, h];
}

/** Extends `words` (at least `firstWord` long) to the 64 words of the SHA-256 message schedule. */
function expandSchedule(words: number[], firstWord = 16): void {
  for (let index = firstWord; index < 64; index += 1) {
    words.push((sigma1(words[index - 2]!) + words[index - 7]! + sigma0(words[index - 15]!) + words[index - 16]!) >>> 0);
  }
}

/** The state after the first block's first 14 rounds, which depends only on the first seven bytes of the text. */
function sha256Init(prefix: Buffer): number[] {
  const words: number[] = new Array<number>(14).fill(0);
  words.push(prefix.readUIntBE(0, 3));
  words.push(prefix.readUInt32BE(3));
  for (let index = 16; index < 30; index += 1) {
    let value = SHA256_SCHEDULE[index - 16]!;
    if (index - 2 >= 14) value += index === 16 ? (sigma1(words[index - 2]!) ^ SHA256_SIGMA1_ADJUSTMENT) >>> 0 : sigma1(words[index - 2]!);
    if (index - 7 >= 14) value += words[index - 7]!;
    if (index - 15 >= 14) value += index === 29 ? (sigma0(words[index - 15]!) ^ SHA256_SIGMA0_ADJUSTMENT) >>> 0 : sigma0(words[index - 15]!);
    words.push(value >>> 0);
  }
  words.push((sigma1(words[28]!) + words[23]! + sigma0(words[15]!) + words[14]! + SHA256_ADJUSTMENT - SHA256_ROUND_CONSTANTS[14]!) >>> 0);
  expandSchedule(words, 31);
  const working = sha256Rounds(SHA256_STATE, words, 14);
  return SHA256_INITIAL.map((value, i) => (value + working[i]!) >>> 0);
}

function sha256Digest(data: Buffer): Buffer {
  if (data.length < 7) throw new Error("Token salt must contain at least seven bytes");
  const length = 57 + data.length;
  const padding = (((55 - length) % 64) + 64) % 64;
  const bitLength = Buffer.alloc(8);
  bitLength.writeBigUInt64BE(BigInt(length) * 8n);
  const padded = Buffer.concat([data.subarray(7), Buffer.from([0x80]), Buffer.alloc(padding), bitLength]);
  let state = sha256Init(data.subarray(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words: number[] = [];
    for (let i = 0; i < 16; i += 1) words.push(padded.readUInt32BE(offset + i * 4));
    expandSchedule(words);
    const working = sha256Rounds(state, words);
    state = state.map((value, i) => (value + working[i]!) >>> 0);
  }
  const out = Buffer.alloc(32);
  state.forEach((value, i) => out.writeUInt32BE(value, i * 4));
  return out;
}

function cs64Digest(data: Buffer, digest: Buffer): [number, number] {
  const keyA = (digest.readUInt32LE(0) | 1) >>> 0;
  const keyB = (digest.readUInt32LE(4) | 1) >>> 0;
  const factors = [mul(keyA, CS64_FACTOR), mul(keyB, CS64_FACTOR)] as const;
  const terms = CS64_COEFFICIENTS.map(([coefficient], index) => mul(coefficient, factors[index % 2]!));
  const offsets = CS64_COEFFICIENTS.map(([, offset]) => offset);
  wordsLittleEndianEven(Buffer.concat([Buffer.from([0]), data])).forEach((word, index) => {
    const even = index % 2 === 0;
    let term = mul(word, even ? keyA : keyB);
    let offset = mul(rol16(word), even ? 0xef0569fb : 0xc31713db);
    if (index === 0) {
      term = (term + mul(CS64_ADJUSTMENT0, factors[0])) >>> 0;
      offset = (offset + CS64_ADJUSTMENT1) >>> 0;
    }
    terms.push(term);
    offsets.push(offset);
  });

  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index]!;
    const y = terms[index + 1]!;
    let t = rol16((offsets[index]! + x) >>> 0);
    let q = mul(t, 0x76f50f34);
    swapAcc = (swapAcc + ((mul(rol16(q), 0xc3efea97) + q) >>> 0)) >>> 0;
    t = rol16((offsets[index + 1]! + y) >>> 0);
    q = mul(t, 0x1881ce3c);
    swapLast = (mul(rol16(q), 0x35bd1ec9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;

    state = (mul(state, keyA) + x) >>> 0;
    state = mul(rol16(state), 0xcf98b111);
    state = mul(rol16(state), 0x87085b9f);
    state = mul(rol16(state), 0x12ceb96d);
    state = mul(rol16(state), 0x257e1d83);
    acc = (acc + state) >>> 0;
    t = (mul(state, keyB) + y) >>> 0;
    t = mul(rol16(t), 0xa27416f5);
    t = mul(rol16(t), 0xd38396ff);
    state = mul(rol16(mul(rol16(t), 0x7c932b89)), 0xbfa49f69);
    acc = (acc + state) >>> 0;
  }
  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}

/**
 * The version-2 `Sec-MS-GEC` value for `nowMs` (Unix milliseconds): the time as Windows file time (100 ns ticks
 * since 1601), rounded down to five minutes, followed by the client token, hashed. Upper-case hex, `<16>-<64>`.
 * BigInt for the tick count (about 1.3e17), which is beyond what a double holds exactly.
 */
export function secMsGecV2(nowMs: number, trustedClientToken: string): string {
  let seconds = Math.floor(nowMs / 1000) + WIN_EPOCH_SECONDS;
  seconds -= seconds % 300;
  const ticks = BigInt(seconds) * TICKS_PER_SECOND;
  const text = Buffer.from(`${ticks}${trustedClientToken}`, "ascii");
  const digest = sha256Digest(text);
  const [first, second] = cs64Digest(text, digest);
  const cs64 = Buffer.alloc(8);
  cs64.writeUInt32LE(first, 0);
  cs64.writeUInt32LE(second, 4);
  return `${cs64.toString("hex").toUpperCase()}-${digest.toString("hex").toUpperCase()}`;
}
