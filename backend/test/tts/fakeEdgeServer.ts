import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

/**
 * A local stand-in for the Edge voice service, speaking the wire protocol as documented by the
 * community `edge-tts` project: a WebSocket upgrade with `Sec-MS-GEC` query parameters, a
 * `speech.config` message and an `ssml` message from the client, then text frames (`turn.start`,
 * `response`, `audio.metadata`, `turn.end`) and binary frames (a two-byte header length, the
 * headers, the MP3) from the server. It checks the shape of what the client sends, but it is only
 * as right as this reading of the protocol: the live service is checked by the opt-in live test.
 */

export interface FakeEdgeConnection {
  attempt: number;
  url: URL;
  headers: IncomingHttpHeaders;
  /** The text messages the client sent, in order (`speech.config`, then `ssml`). */
  messages: string[];
}

export interface Refusal {
  status: number;
  headers?: Record<string, string>;
}

export interface FakeEdgeServerOptions {
  /** Refuse an upgrade with an HTTP response instead of completing the handshake. */
  refuse?: (request: IncomingMessage, attempt: number) => Refusal | undefined;
  /** Called when the client has sent its two messages: drive the conversation. */
  onSynthesis?: (session: FakeSession, connection: FakeEdgeConnection) => void | Promise<void>;
}

/** One binary frame as the service sends it: two bytes of header length, the headers, the audio. */
export function audioFrame(payload: Buffer, options: { path?: string; contentType?: string | null } = {}): Buffer {
  const lines = ["X-RequestId:fake0000fake0000fake0000fake0000"];
  if (options.contentType !== null) lines.push(`Content-Type:${options.contentType ?? "audio/mpeg"}`);
  lines.push("X-Timestamp:2026-10-04T10:00:00.000Z", `Path:${options.path ?? "audio"}`);
  const headers = Buffer.from(lines.join("\r\n") + "\r\n", "utf8");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(headers.length, 0);
  return Buffer.concat([length, headers, payload]);
}

export class FakeSession {
  constructor(readonly ws: WebSocket) {}

  text(path: string, body = "{}"): void {
    this.ws.send(`X-RequestId:fake0000fake0000fake0000fake0000\r\nContent-Type:application/json; charset=utf-8\r\nPath:${path}\r\n\r\n${body}`);
  }

  audio(payload: Buffer, options?: { path?: string; contentType?: string | null }): void {
    this.ws.send(audioFrame(payload, options), { binary: true });
  }

  raw(data: Buffer, binary = true): void {
    this.ws.send(data, { binary });
  }

  end(): void {
    this.text("turn.end");
  }

  close(): void {
    this.ws.close();
  }

  terminate(): void {
    this.ws.terminate();
  }

  /** The service's normal answer: start, the MP3 in pieces, the end-of-audio marker, end. */
  async speak(mp3: Buffer, pieceSize = 1024, gapMs = 0): Promise<void> {
    this.text("turn.start");
    this.text("response");
    for (let offset = 0; offset < mp3.length; offset += pieceSize) {
      this.audio(mp3.subarray(offset, offset + pieceSize));
      if (gapMs) await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
    this.text("audio.metadata", '{"Metadata":[{"Type":"SessionEnd","Data":{"Offset":1}}]}');
    this.audio(Buffer.alloc(0), { contentType: null });
    this.end();
  }
}

export class FakeEdgeServer {
  readonly connections: FakeEdgeConnection[] = [];
  readonly refused: Array<{ attempt: number; url: string; headers: IncomingHttpHeaders }> = [];
  /** Connections that have ended, from either side. */
  closedConnections = 0;
  url = "";

  private readonly server = http.createServer();
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly sockets = new Set<WebSocket>();
  private attempts = 0;

  constructor(private readonly options: FakeEdgeServerOptions = {}) {
    this.server.on("upgrade", (request, socket, head) => {
      const attempt = this.attempts;
      this.attempts += 1;
      const refusal = this.options.refuse?.(request, attempt);
      if (refusal) {
        this.refused.push({ attempt, url: request.url ?? "", headers: request.headers });
        const headers = { Date: new Date().toUTCString(), ...refusal.headers };
        const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
        socket.write(`HTTP/1.1 ${refusal.status} Refused\r\n${lines.join("\r\n")}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        const connection: FakeEdgeConnection = { attempt, url: new URL(request.url ?? "/", "http://fake"), headers: request.headers, messages: [] };
        this.connections.push(connection);
        this.sockets.add(ws);
        ws.on("close", () => {
          this.closedConnections += 1;
          this.sockets.delete(ws);
        });
        ws.on("error", () => undefined);
        ws.on("message", (data: RawData) => {
          connection.messages.push(data.toString());
          if (connection.messages.length === 2) void this.options.onSynthesis?.(new FakeSession(ws), connection);
        });
      });
    });
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.url = `ws://127.0.0.1:${(this.server.address() as AddressInfo).port}/consumer/speech/synthesize/readaloud/edge/v1`;
    return this;
  }

  async stop(): Promise<void> {
    for (const ws of this.sockets) ws.terminate();
    this.wss.close();
    this.server.closeAllConnections?.();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Waits until `check` holds (the client's side of a close can take a few event-loop turns to show here). */
  async until(check: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the fake server");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}
