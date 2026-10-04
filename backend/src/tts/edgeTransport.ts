/**
 * The network half of the Edge voice: one WebSocket conversation with Microsoft's "Read Aloud"
 * speech service, the one the Edge browser uses. SSML goes in, MP3 chunks come out as they are
 * produced. Everything else (which voice, splitting text, decoding the MP3, retrying, protecting
 * the service) is in `edgeTtsProvider.ts`; this file knows only the wire.
 *
 * Why it is written here and not taken from an npm package: the maintained Edge packages are
 * AGPL, GPL or non-commercial licensed, or (the one MIT package) have no timeouts, no way to cancel
 * one request, no XML escaping and a tree of 39 packages. The protocol is small, and the
 * community `edge-tts` project documents it. Only `ws` is needed.
 *
 * This is an unofficial service: Microsoft does not publish it as an API, gives no guarantee, and
 * has changed what it requires before (the `Sec-MS-GEC` token, the browser version it expects).
 * The constants below are the ones to update when it does. Keep this the only file that knows
 * them, and keep `EdgeTransport` the only thing the rest of the code depends on, so the transport
 * can move to a separate service (or be replaced by an official one) without touching the routes.
 */
import { createHash, randomBytes } from "node:crypto";
import type WebSocket from "ws";
import type { RawData } from "ws";
import { TtsProviderError, abortError } from "./provider.js";

export const EDGE_SERVICE_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
export const EDGE_VOICES_URL = "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list";
/** Public, embedded in the Edge browser; not a secret. */
export const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
/** The Edge version the service expects to be talking to. Update with the service's requirements. */
export const CHROMIUM_FULL_VERSION = "143.0.3650.75";
/** The only audio format the service offers that is not a container of its own: 24 kHz, 48 kbit/s, mono MP3. */
export const EDGE_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

/** One synthesis against the service: SSML in, the MP3 it produced out, in order, as it arrives. */
export interface EdgeTransport {
  synthesize(ssml: string, signal?: AbortSignal): AsyncIterable<Buffer>;
}

/**
 * The `Sec-MS-GEC` value: SHA-256 of the current time as Windows file time (100 ns ticks since
 * 1601), rounded down to five minutes, followed by the trusted client token; upper-case hex.
 * BigInt, because the tick count (about 1.3e17) is beyond what a double holds exactly.
 */
export function secMsGec(nowMs: number): string {
  let seconds = Math.floor(nowMs / 1000) + 11_644_473_600;
  seconds -= seconds % 300;
  const ticks = BigInt(seconds) * 10_000_000n;
  return createHash("sha256").update(`${ticks}${TRUSTED_CLIENT_TOKEN}`, "ascii").digest("hex").toUpperCase();
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number): string => String(value).padStart(2, "0");

/** The JavaScript-style UTC date the service's messages carry: `Sun Oct 04 2026 09:45:00 GMT+0000 (Coordinated Universal Time)`. */
export function edgeTimestamp(date: Date): string {
  return (
    `${DAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${pad(date.getUTCDate())} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  );
}

function userAgent(): string {
  const major = CHROMIUM_FULL_VERSION.split(".")[0];
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`;
}

function handshakeHeaders(): Record<string, string> {
  return {
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    "User-Agent": userAgent(),
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: `muid=${randomBytes(16).toString("hex").toUpperCase()};`,
  };
}

/** Headers of one frame (`Name:value` lines), by name. */
function parseHeaders(text: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of text.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return headers;
}

/** The unit of work the service rejects when it disagrees with our clock; see `synthesize`. */
class ClockSkewRejection extends Error {
  constructor(readonly skewMs: number) {
    super("The voice service refused the connection (403); correcting the clock");
  }
}

/** A small single-consumer queue that turns socket events into something `for await` can read. */
class AsyncQueue<T> {
  private items: T[] = [];
  private wake: (() => void) | undefined;
  private ended = false;
  private failure: { error: unknown } | undefined;

  push(item: T): void {
    if (this.ended || this.failure) return;
    this.items.push(item);
    this.signal();
  }

  end(): void {
    if (this.failure) return;
    this.ended = true;
    this.signal();
  }

  /** Keeps the first failure. Audio queued before it is still delivered first. */
  fail(error: unknown): void {
    if (this.ended || this.failure) return;
    this.failure = { error };
    this.signal();
  }

  /** A failure that must not wait behind queued audio (a cancellation). */
  failNow(error: unknown): void {
    if (this.ended) return;
    this.items = [];
    this.failure = this.failure ?? { error };
    this.signal();
  }

  private signal(): void {
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  async next(): Promise<IteratorResult<T>> {
    for (;;) {
      if (this.items.length > 0) return { value: this.items.shift() as T, done: false };
      if (this.failure) throw this.failure.error;
      if (this.ended) return { value: undefined, done: true };
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

export interface WebSocketTransportOptions {
  /** The service address. Tests point it at a local fake. */
  url?: string;
  /** Time allowed to open the connection. */
  connectTimeoutMs?: number;
  /** Longest silence between two messages once connected. */
  idleTimeoutMs?: number;
  /** Longest one synthesis may take, start to finish. */
  totalTimeoutMs?: number;
  /** Most MP3 one synthesis may produce (about 22 minutes of speech at 48 kbit/s). */
  maxAudioBytes?: number;
  now?: () => number;
}

export class WebSocketEdgeTransport implements EdgeTransport {
  private readonly url: string;
  private readonly connectTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly maxAudioBytes: number;
  private readonly now: () => number;
  /** Server time minus ours, learned from a 403's `Date` header. */
  private clockSkewMs = 0;

  constructor(options: WebSocketTransportOptions = {}) {
    this.url = options.url ?? EDGE_SERVICE_URL;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 15_000;
    this.totalTimeoutMs = options.totalTimeoutMs ?? 60_000;
    this.maxAudioBytes = options.maxAudioBytes ?? 8 * 1024 * 1024;
    this.now = options.now ?? Date.now;
  }

  /**
   * A 403 on connect usually means our clock disagrees with theirs (the token is time based). The
   * correction is learned from the response's `Date` header and the connection is tried once
   * more, before anything has been yielded; a second 403 is a real refusal.
   */
  async *synthesize(ssml: string, signal?: AbortSignal): AsyncGenerator<Buffer> {
    try {
      yield* this.session(ssml, signal);
    } catch (error) {
      if (!(error instanceof ClockSkewRejection)) throw error;
      this.clockSkewMs += error.skewMs;
      try {
        yield* this.session(ssml, signal);
      } catch (second) {
        if (second instanceof ClockSkewRejection) {
          // Both refusals are HTTP 403. What separates "our clock or token is off" from "this address is blocked"
          // is whether the clocks still differ after the correction, so the log says by how much.
          const seconds = Math.round(second.skewMs / 1000);
          throw new TtsProviderError(`The voice service refused the connection (HTTP 403 twice; after correcting for its clock, the difference was still ${seconds} s)`, "REJECTED", false);
        }
        throw second;
      }
    }
  }

  private connectionUrl(): string {
    const params = new URLSearchParams({
      TrustedClientToken: TRUSTED_CLIENT_TOKEN,
      ConnectionId: randomBytes(16).toString("hex"),
      "Sec-MS-GEC": secMsGec(this.now() + this.clockSkewMs),
      "Sec-MS-GEC-Version": `1-${CHROMIUM_FULL_VERSION}`,
    });
    return `${this.url}?${params.toString()}`;
  }

  private async *session(ssml: string, signal?: AbortSignal): AsyncGenerator<Buffer> {
    if (signal?.aborted) throw abortError();

    let ws: WebSocket;
    try {
      // Loaded on first use, so the requests that never speak (nearly all of them) do not pay for it at start-up.
      const { default: WebSocketImpl } = await import("ws");
      ws = new WebSocketImpl(this.connectionUrl(), {
        headers: handshakeHeaders(),
        handshakeTimeout: this.connectTimeoutMs,
        maxPayload: 1024 * 1024,
      });
    } catch (error) {
      throw new TtsProviderError("The voice service could not be reached", "UNAVAILABLE", true, { cause: error });
    }

    const queue = new AsyncQueue<Buffer>();
    let turnEnded = false;
    let audioFrames = 0;
    let audioBytes = 0;
    const unknownPaths = new Set<string>();
    let idleTimer: NodeJS.Timeout | undefined;

    const fail = (error: unknown): void => {
      queue.fail(error);
      ws.terminate();
    };
    const timeout = (what: string): TtsProviderError => new TtsProviderError(`The voice service timed out (${what})`, "TIMEOUT", true);
    const touch = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => fail(timeout("no data")), this.idleTimeoutMs);
    };
    const totalTimer = setTimeout(() => fail(timeout("too long")), this.totalTimeoutMs);
    const onAbort = (): void => {
      queue.failNow(abortError());
      ws.terminate();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    // An error with nobody listening would crash the process; this listener stays for the socket's life.
    ws.on("error", (error: Error & { code?: string }) => {
      const timedOut = /timed out/i.test(error.message);
      fail(
        timedOut
          ? timeout("connect")
          : new TtsProviderError("The voice service could not be reached", "UNAVAILABLE", true, { cause: error }),
      );
    });

    ws.on("unexpected-response", (_request, response) => {
      const status = response.statusCode ?? 0;
      const serverDate = Date.parse(String(response.headers.date ?? ""));
      const retryAfter = Number(response.headers["retry-after"]);
      response.resume();
      if (status === 403 && Number.isFinite(serverDate)) {
        fail(new ClockSkewRejection(serverDate - this.now() - this.clockSkewMs));
      } else if (status === 408 || status === 429 || status >= 500) {
        fail(
          new TtsProviderError(`The voice service answered ${status}`, "UNAVAILABLE", true, {
            retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
          }),
        );
      } else {
        fail(new TtsProviderError(`The voice service refused the connection (${status})`, "REJECTED", false));
      }
    });

    ws.on("open", () => {
      touch();
      // Sentence boundaries on, word boundaries off: the setting the community client sends by default, so the
      // one most exercised against the live service. The boundary messages that come back are not used.
      const config = JSON.stringify({
        context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: "true", wordBoundaryEnabled: "false" }, outputFormat: EDGE_OUTPUT_FORMAT } } },
      });
      ws.send(`X-Timestamp:${edgeTimestamp(new Date(this.now()))}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${config}\r\n`);
      // The `Z` after the second timestamp is not a typo: the Edge browser sends it, and so must we.
      ws.send(
        `X-RequestId:${randomBytes(16).toString("hex")}\r\nContent-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${edgeTimestamp(new Date(this.now()))}Z\r\nPath:ssml\r\n\r\n${ssml}`,
      );
    });

    ws.on("message", (data: RawData, isBinary: boolean) => {
      touch();
      try {
        const frame = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
        if (!isBinary) {
          const text = frame.toString("utf8");
          const separator = text.indexOf("\r\n\r\n");
          const path = parseHeaders(separator >= 0 ? text.slice(0, separator) : text).get("Path");
          if (path === "turn.end") {
            turnEnded = true;
            if (audioFrames === 0) {
              const seen = unknownPaths.size ? ` (it also sent: ${[...unknownPaths].slice(0, 5).join(", ")})` : "";
              fail(new TtsProviderError(`The voice service finished without producing audio${seen}`, "NO_AUDIO", false));
            } else {
              queue.end();
            }
          } else if (path !== "turn.start" && path !== "response" && path !== "audio.metadata" && path) {
            unknownPaths.add(path.slice(0, 40));
          }
          return;
        }

        // Binary frame: two bytes of header length (big endian), the headers, then the audio.
        if (frame.length < 2) throw new TtsProviderError("The voice service sent a malformed audio message", "BAD_AUDIO", false);
        const headerLength = frame.readUInt16BE(0);
        if (2 + headerLength > frame.length) throw new TtsProviderError("The voice service sent a malformed audio message", "BAD_AUDIO", false);
        const headers = parseHeaders(frame.subarray(2, 2 + headerLength).toString("utf8"));
        const payload = frame.subarray(2 + headerLength);
        if (headers.get("Path") !== "audio") throw new TtsProviderError("The voice service sent an unexpected binary message", "BAD_AUDIO", false);
        const contentType = headers.get("Content-Type");
        if (contentType !== undefined && contentType !== "audio/mpeg") {
          throw new TtsProviderError("The voice service sent audio in an unexpected format", "BAD_AUDIO", false);
        }
        if (payload.length === 0) return; // the empty frame that marks the end of the audio
        if (contentType === undefined) throw new TtsProviderError("The voice service sent audio without saying what it is", "BAD_AUDIO", false);
        audioBytes += payload.length;
        if (audioBytes > this.maxAudioBytes) throw new TtsProviderError("The voice service sent more audio than expected", "BAD_AUDIO", false);
        audioFrames += 1;
        queue.push(Buffer.from(payload));
      } catch (error) {
        fail(error);
      }
    });

    ws.on("close", () => {
      if (turnEnded) queue.end();
      else queue.fail(new TtsProviderError("The voice service closed the connection before it finished", "UNAVAILABLE", true));
    });

    try {
      for (;;) {
        const next = await queue.next();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(totalTimer);
      signal?.removeEventListener("abort", onAbort);
      // Finished, failed or abandoned by the consumer: either way the connection ends here.
      ws.terminate();
    }
  }
}

export interface EdgeVoiceInfo {
  ShortName: string;
  Locale: string;
  Gender?: string;
  FriendlyName?: string;
}

/**
 * The voices the service offers right now. Not used to serve a request: it exists so the opt-in
 * live test and probe can prove that the configured voices exist, instead of assuming it.
 */
export async function listEdgeVoices(options: { now?: () => number; fetchImpl?: typeof fetch } = {}): Promise<EdgeVoiceInfo[]> {
  const now = options.now ?? Date.now;
  const query = new URLSearchParams({ trustedclienttoken: TRUSTED_CLIENT_TOKEN, "Sec-MS-GEC": secMsGec(now()), "Sec-MS-GEC-Version": `1-${CHROMIUM_FULL_VERSION}` });
  const headers = { "User-Agent": userAgent(), Accept: "*/*", "Accept-Language": "en-US,en;q=0.9", Cookie: `muid=${randomBytes(16).toString("hex").toUpperCase()};` };
  const response = await (options.fetchImpl ?? fetch)(`${EDGE_VOICES_URL}?${query.toString()}`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`The voice list answered HTTP ${response.status}`);
  return (await response.json()) as EdgeVoiceInfo[];
}
