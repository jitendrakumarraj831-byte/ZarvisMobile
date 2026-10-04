import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHROMIUM_FULL_VERSION,
  EDGE_OUTPUT_FORMAT,
  TRUSTED_CLIENT_TOKEN,
  WebSocketEdgeTransport,
  edgeTimestamp,
  listEdgeVoices,
  secMsGec,
  type WebSocketTransportOptions,
} from "../../src/tts/edgeTransport.js";
import { TtsProviderError, isAbortError } from "../../src/tts/provider.js";
import { FakeEdgeServer, type FakeEdgeServerOptions } from "./fakeEdgeServer.js";
import { edgeLikeMp3 } from "./helpers.js";

const servers: FakeEdgeServer[] = [];
const silentServers: net.Server[] = [];
const silentConnections = new Set<net.Socket>();
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  for (const connection of silentConnections) connection.destroy();
  silentConnections.clear();
  await Promise.all(silentServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

/** A TCP server that accepts a connection and never says a word: a connection that never completes. */
async function silentUrl(): Promise<string> {
  const server = net.createServer((socket) => {
    silentConnections.add(socket);
    socket.on("error", () => undefined);
    socket.resume(); // read, so that the client closing is noticed
  });
  silentServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}/x`;
}

async function serve(options?: FakeEdgeServerOptions): Promise<FakeEdgeServer> {
  const server = await new FakeEdgeServer(options).start();
  servers.push(server);
  return server;
}

const transportFor = (server: FakeEdgeServer, options: WebSocketTransportOptions = {}) => new WebSocketEdgeTransport({ url: server.url, ...options });

async function collect(iterable: AsyncIterable<Buffer>): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

async function failureOf(iterable: AsyncIterable<Buffer>): Promise<{ chunks: Buffer[]; error: unknown }> {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of iterable) chunks.push(chunk);
  } catch (error) {
    return { chunks, error };
  }
  throw new Error("expected the synthesis to fail");
}

const SSML = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='en-US-JennyNeural'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>Hello.</prosody></voice></speak>";

describe("the Sec-MS-GEC token", () => {
  // Computed with the reference implementation (the community edge-tts library's algorithm).
  it("matches the reference algorithm: SHA-256 of the five-minute window in Windows ticks plus the client token", () => {
    expect(secMsGec(1_700_000_000_000)).toBe("42301B335578FEFDAE2637DED1ABD614505D432559EC08032B82048483726AFF");
    expect(secMsGec(1_790_000_000_000)).toBe("CA99F0B37F2EAC6F5D719AE4BA7C98978842B3F335D9F42979070A8DB149F0A5");
    expect(secMsGec(0)).toBe("7ECB79D14E3AA576D2D79E6D487A1388156D91E614B1BE11C64226A29BC8DD8C");
  });

  it("is constant inside a five-minute window and changes at its edge", () => {
    expect(secMsGec(1_700_000_099_000)).toBe(secMsGec(1_700_000_000_000));
    expect(secMsGec(1_700_000_099_999)).toBe(secMsGec(1_700_000_000_000));
    expect(secMsGec(1_700_000_100_000)).toBe("AE4CF72E466874182A75878E20EADA83D29A1C12CAD9C3E0E014CCE0BFA55880");
    expect(secMsGec(1_790_000_299_000)).toBe(secMsGec(1_790_000_300_000));
  });

  it("is upper-case hex of 64 characters", () => {
    expect(secMsGec(Date.now())).toMatch(/^[0-9A-F]{64}$/);
  });
});

describe("the message timestamp", () => {
  it("is the JavaScript-style UTC date the service's messages carry, whatever the process time zone", () => {
    expect(edgeTimestamp(new Date(Date.UTC(2026, 9, 4, 9, 5, 7)))).toBe("Sun Oct 04 2026 09:05:07 GMT+0000 (Coordinated Universal Time)");
    expect(edgeTimestamp(new Date(Date.UTC(2024, 1, 29, 23, 59, 59)))).toBe("Thu Feb 29 2024 23:59:59 GMT+0000 (Coordinated Universal Time)");
  });
});

describe("WebSocketEdgeTransport: the conversation", () => {
  it("connects the way the Edge browser does", async () => {
    const now = 1_790_000_200_000;
    const server = await serve({ onSynthesis: (session) => session.speak(edgeLikeMp3()) });
    await collect(transportFor(server, { now: () => now }).synthesize(SSML));

    expect(server.connections).toHaveLength(1);
    const { url, headers } = server.connections[0]!;
    expect(url.pathname).toBe("/consumer/speech/synthesize/readaloud/edge/v1");
    expect(url.searchParams.get("TrustedClientToken")).toBe(TRUSTED_CLIENT_TOKEN);
    expect(url.searchParams.get("ConnectionId")).toMatch(/^[0-9a-f]{32}$/);
    expect(url.searchParams.get("Sec-MS-GEC")).toBe(secMsGec(now));
    expect(url.searchParams.get("Sec-MS-GEC-Version")).toBe(`1-${CHROMIUM_FULL_VERSION}`);
    expect(headers.origin).toBe("chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold");
    expect(headers["user-agent"]).toMatch(/Chrome\/143\.0\.0\.0 Safari\/537\.36 Edg\/143\.0\.0\.0$/);
    expect(headers.cookie).toMatch(/^muid=[0-9A-F]{32};$/);
    expect(headers.pragma).toBe("no-cache");
  });

  it("sends the speech configuration, then the SSML, and nothing else", async () => {
    const now = Date.UTC(2026, 9, 4, 9, 5, 7);
    const server = await serve({ onSynthesis: (session) => session.speak(edgeLikeMp3()) });
    await collect(transportFor(server, { now: () => now }).synthesize(SSML));

    const [config, ssml, ...rest] = server.connections[0]!.messages;
    expect(rest).toEqual([]);
    expect(config).toMatch(/^X-Timestamp:Sun Oct 04 2026 09:05:07 GMT\+0000 \(Coordinated Universal Time\)\r\nContent-Type:application\/json; charset=utf-8\r\nPath:speech\.config\r\n\r\n/);
    const body = JSON.parse(config!.split("\r\n\r\n")[1]!);
    expect(body.context.synthesis.audio.outputFormat).toBe(EDGE_OUTPUT_FORMAT);
    expect(EDGE_OUTPUT_FORMAT).toBe("audio-24khz-48kbitrate-mono-mp3");
    expect(ssml).toMatch(/^X-RequestId:[0-9a-f]{32}\r\nContent-Type:application\/ssml\+xml\r\nX-Timestamp:Sun Oct 04 2026 09:05:07 GMT\+0000 \(Coordinated Universal Time\)Z\r\nPath:ssml\r\n\r\n/);
    expect(ssml!.split("\r\n\r\n")[1]).toBe(SSML);
  });

  it("yields the audio bytes of every binary frame, in order and without the headers, and ignores the rest", async () => {
    const mp3 = edgeLikeMp3();
    const server = await serve({ onSynthesis: (session) => session.speak(mp3, 700) });
    const chunks = await collect(transportFor(server).synthesize(SSML));
    expect(chunks.length).toBe(Math.ceil(mp3.length / 700));
    expect(Buffer.concat(chunks).equals(mp3)).toBe(true);
  });

  it("starts delivering before the service has finished (it streams)", async () => {
    const server = await serve({ onSynthesis: (session) => session.speak(edgeLikeMp3(), 1000, 40) });
    const iterator = transportFor(server).synthesize(SSML)[Symbol.asyncIterator]();
    const started = Date.now();
    const first = await iterator.next();
    const firstAfter = Date.now() - started;
    expect(first.done).toBe(false);
    let rest = 0;
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      rest += 1;
    }
    expect(rest).toBeGreaterThan(3);
    expect(Date.now() - started).toBeGreaterThan(firstAfter + 100); // the rest took real time after the first chunk
  });

  it("gives each of several simultaneous syntheses its own connection and its own audio", async () => {
    const server = await serve({
      onSynthesis: async (session, connection) => {
        const marker = /voice name='([^']+)'/.exec(connection.messages[1]!)![1]!;
        session.text("turn.start");
        for (let i = 0; i < 5; i += 1) {
          session.audio(Buffer.from(`${marker}:${i};`));
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        session.end();
      },
    });
    const transport = transportFor(server);
    const ssmlFor = (voice: string) => SSML.replace("en-US-JennyNeural", voice);
    const [a, b, c] = await Promise.all(["en-US-AAANeural", "hi-IN-BBBNeural", "en-IN-CCCNeural"].map((voice) => collect(transport.synthesize(ssmlFor(voice)))));
    expect(Buffer.concat(a!).toString()).toBe([0, 1, 2, 3, 4].map((i) => `en-US-AAANeural:${i};`).join(""));
    expect(Buffer.concat(b!).toString()).toBe([0, 1, 2, 3, 4].map((i) => `hi-IN-BBBNeural:${i};`).join(""));
    expect(Buffer.concat(c!).toString()).toBe([0, 1, 2, 3, 4].map((i) => `en-IN-CCCNeural:${i};`).join(""));
    expect(server.connections).toHaveLength(3);
  });
});

describe("WebSocketEdgeTransport: the clock", () => {
  it("learns the server's time from a 403's Date header and connects again, once, with the right token", async () => {
    const clientNow = 1_790_000_200_000; // mid window
    const serverNow = clientNow + 10 * 60_000; // the service's clock is ten minutes ahead
    const server = await serve({
      refuse: (request) => {
        const token = new URL(request.url ?? "/", "http://x").searchParams.get("Sec-MS-GEC");
        return token === secMsGec(serverNow) ? undefined : { status: 403, headers: { Date: new Date(serverNow).toUTCString() } };
      },
      onSynthesis: (session) => session.speak(edgeLikeMp3()),
    });
    const chunks = await collect(transportFor(server, { now: () => clientNow }).synthesize(SSML));

    expect(Buffer.concat(chunks).equals(edgeLikeMp3())).toBe(true);
    expect(server.refused).toHaveLength(1);
    expect(server.connections).toHaveLength(1);
    expect(server.connections[0]!.url.searchParams.get("Sec-MS-GEC")).toBe(secMsGec(serverNow));
    expect(server.refused[0]!.url).toContain(`Sec-MS-GEC=${secMsGec(clientNow)}`);
  });

  it("remembers the correction for the next request", async () => {
    const clientNow = 1_790_000_200_000;
    const serverNow = clientNow + 10 * 60_000;
    const server = await serve({
      refuse: (request) => (new URL(request.url ?? "/", "http://x").searchParams.get("Sec-MS-GEC") === secMsGec(serverNow) ? undefined : { status: 403, headers: { Date: new Date(serverNow).toUTCString() } }),
      onSynthesis: (session) => session.speak(edgeLikeMp3()),
    });
    const transport = transportFor(server, { now: () => clientNow });
    await collect(transport.synthesize(SSML));
    await collect(transport.synthesize(SSML));
    expect(server.refused).toHaveLength(1); // only the very first connection was refused
    expect(server.connections).toHaveLength(2);
  });

  it("calls a second 403 a refusal, and does not try a third time", async () => {
    const server = await serve({ refuse: () => ({ status: 403 }) });
    const { error } = await failureOf(transportFor(server).synthesize(SSML));
    expect(error).toBeInstanceOf(TtsProviderError);
    expect(error).toMatchObject({ kind: "REJECTED", retryable: false });
    expect(server.refused).toHaveLength(2);
  });

  it("calls a 403 with no usable Date header a refusal at once", async () => {
    const server = await serve({ refuse: () => ({ status: 403, headers: { Date: "not a date" } }) });
    const { error } = await failureOf(transportFor(server).synthesize(SSML));
    expect(error).toMatchObject({ kind: "REJECTED", retryable: false });
    expect(server.refused).toHaveLength(1);
  });
});

describe("WebSocketEdgeTransport: when the service says no", () => {
  it("treats 429 as temporary and passes on Retry-After", async () => {
    const server = await serve({ refuse: () => ({ status: 429, headers: { "Retry-After": "7" } }) });
    const { error } = await failureOf(transportFor(server).synthesize(SSML));
    expect(error).toMatchObject({ kind: "UNAVAILABLE", retryable: true, retryAfterMs: 7000 });
  });

  it("treats a server error as temporary", async () => {
    const server = await serve({ refuse: () => ({ status: 503 }) });
    const { error } = await failureOf(transportFor(server).synthesize(SSML));
    expect(error).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
  });

  it("treats the other client errors as a refusal that retrying will not change", async () => {
    for (const status of [400, 401, 404]) {
      const server = await serve({ refuse: () => ({ status }) });
      const { error } = await failureOf(transportFor(server).synthesize(SSML));
      expect(error, `HTTP ${status}`).toMatchObject({ kind: "REJECTED", retryable: false });
    }
  });

  it("reports a service nobody is listening at as unavailable", async () => {
    const server = await serve();
    const url = server.url;
    await server.stop();
    servers.splice(servers.indexOf(server), 1);
    const { error } = await failureOf(new WebSocketEdgeTransport({ url }).synthesize(SSML));
    expect(error).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
  });

  it("times out when the connection never completes", async () => {
    const url = await silentUrl();
    const started = Date.now();
    const { error } = await failureOf(new WebSocketEdgeTransport({ url, connectTimeoutMs: 150 }).synthesize(SSML));
    expect(error).toMatchObject({ kind: "TIMEOUT", retryable: true });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("times out when the service goes quiet in the middle, and drops the connection", async () => {
    const server = await serve({ onSynthesis: (session) => { session.text("turn.start"); session.audio(Buffer.from("partial")); } });
    const { chunks, error } = await failureOf(transportFor(server, { idleTimeoutMs: 120 }).synthesize(SSML));
    expect(Buffer.concat(chunks).toString()).toBe("partial");
    expect(error).toMatchObject({ kind: "TIMEOUT", retryable: true });
    await server.until(() => server.closedConnections === 1);
  });

  it("times out a synthesis that goes on for too long even while it keeps sending", async () => {
    const server = await serve({
      onSynthesis: async (session) => {
        session.text("turn.start");
        while (session.ws.readyState === 1) {
          session.audio(Buffer.alloc(8));
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
      },
    });
    const { error } = await failureOf(transportFor(server, { totalTimeoutMs: 250, idleTimeoutMs: 5000 }).synthesize(SSML));
    expect(error).toMatchObject({ kind: "TIMEOUT" });
    await server.until(() => server.closedConnections === 1);
  });

  it("reports a connection that closes before the turn ends as unavailable, after the audio it did send", async () => {
    const server = await serve({
      onSynthesis: async (session) => {
        session.text("turn.start");
        session.audio(Buffer.from("half a sentence"));
        await new Promise((resolve) => setTimeout(resolve, 20));
        session.close();
      },
    });
    const { chunks, error } = await failureOf(transportFor(server).synthesize(SSML));
    expect(Buffer.concat(chunks).toString()).toBe("half a sentence");
    expect(error).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
  });

  it("reports a turn that ends without any audio, naming a path it did not understand", async () => {
    const server = await serve({ onSynthesis: (session) => { session.text("turn.start"); session.text("surprise.path"); session.end(); } });
    const { error } = await failureOf(transportFor(server).synthesize(SSML));
    expect(error).toMatchObject({ kind: "NO_AUDIO", retryable: false });
    expect((error as Error).message).toContain("surprise.path");
  });

  it("refuses a binary message that is not audio from the audio path, or not MP3", async () => {
    const cases: Array<[string, (session: Parameters<NonNullable<FakeEdgeServerOptions["onSynthesis"]>>[0]) => void]> = [
      ["another path", (s) => s.audio(Buffer.from("x"), { path: "something" })],
      ["another content type", (s) => s.audio(Buffer.from("x"), { contentType: "audio/ogg" })],
      ["no content type but data", (s) => s.audio(Buffer.from("x"), { contentType: null })],
      ["a one byte message", (s) => s.raw(Buffer.from([1]))],
      ["a header length beyond the message", (s) => s.raw(Buffer.from([0xff, 0xff, 1, 2, 3]))],
    ];
    for (const [label, send] of cases) {
      const server = await serve({ onSynthesis: (session) => send(session) });
      const { error } = await failureOf(transportFor(server).synthesize(SSML));
      expect(error, label).toMatchObject({ kind: "BAD_AUDIO", retryable: false });
    }
  });

  it("refuses more audio than any reply could need", async () => {
    const server = await serve({ onSynthesis: (session) => { session.audio(Buffer.alloc(600)); session.audio(Buffer.alloc(600)); session.end(); } });
    const { error } = await failureOf(transportFor(server, { maxAudioBytes: 1000 }).synthesize(SSML));
    expect(error).toMatchObject({ kind: "BAD_AUDIO" });
  });
});

describe("WebSocketEdgeTransport: cancelling", () => {
  it("stops at once when the signal aborts mid-stream, and closes the connection", async () => {
    const server = await serve({
      onSynthesis: async (session) => {
        session.text("turn.start");
        while (session.ws.readyState === 1) {
          session.audio(Buffer.alloc(16));
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      },
    });
    const controller = new AbortController();
    const chunks: Buffer[] = [];
    let thrown: unknown;
    try {
      for await (const chunk of transportFor(server).synthesize(SSML, controller.signal)) {
        chunks.push(chunk);
        if (chunks.length === 2) controller.abort();
      }
    } catch (error) {
      thrown = error;
    }
    expect(isAbortError(thrown)).toBe(true);
    expect(chunks).toHaveLength(2);
    await server.until(() => server.closedConnections === 1);
  });

  it("does not connect at all when the signal is already aborted", async () => {
    const server = await serve();
    const controller = new AbortController();
    controller.abort();
    const { error } = await failureOf(transportFor(server).synthesize(SSML, controller.signal));
    expect(isAbortError(error)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.connections).toHaveLength(0);
  });

  it("aborts a connection that is still being made", async () => {
    const url = await silentUrl();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 60);
    const { error } = await failureOf(new WebSocketEdgeTransport({ url, connectTimeoutMs: 5000 }).synthesize(SSML, controller.signal));
    expect(isAbortError(error)).toBe(true);
  });

  it("closes the connection when the consumer simply stops reading", async () => {
    const server = await serve({
      onSynthesis: async (session) => {
        session.text("turn.start");
        while (session.ws.readyState === 1) {
          session.audio(Buffer.alloc(16));
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      },
    });
    const iterator = transportFor(server).synthesize(SSML)[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    await iterator.return?.(undefined);
    await server.until(() => server.closedConnections === 1);
  });

  it("closes the connection once the turn has ended", async () => {
    const server = await serve({ onSynthesis: (session) => session.speak(edgeLikeMp3()) });
    await collect(transportFor(server).synthesize(SSML));
    await server.until(() => server.closedConnections === 1);
  });
});

describe("listEdgeVoices", () => {
  it("asks for the voice list the way the browser does, and returns what it is given", async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];
    const voices = await listEdgeVoices({
      now: () => 1_790_000_200_000,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), headers: init?.headers as Record<string, string> });
        return new Response(JSON.stringify([{ ShortName: "hi-IN-SwaraNeural", Locale: "hi-IN", Gender: "Female" }]), { status: 200 });
      }) as typeof fetch,
    });
    expect(voices).toEqual([{ ShortName: "hi-IN-SwaraNeural", Locale: "hi-IN", Gender: "Female" }]);
    const url = new URL(requests[0]!.url);
    expect(url.origin + url.pathname).toBe("https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list");
    expect(url.searchParams.get("trustedclienttoken")).toBe(TRUSTED_CLIENT_TOKEN);
    expect(url.searchParams.get("Sec-MS-GEC")).toBe(secMsGec(1_790_000_200_000));
    expect(url.searchParams.get("Sec-MS-GEC-Version")).toBe(`1-${CHROMIUM_FULL_VERSION}`);
  });

  it("fails loudly when the list cannot be fetched", async () => {
    await expect(listEdgeVoices({ fetchImpl: (async () => new Response("no", { status: 403 })) as typeof fetch })).rejects.toThrow(/403/);
  });
});
