import { Router, type Response } from "express";
import { logger } from "../../security/redact.js";
import { TtsProviderError, type TtsProvider } from "../../tts/provider.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";

/** The text one request may speak. The web client sends sentences of about 300 characters; Listen sends a whole reply. */
export const MAX_STREAM_TEXT_CHARS = 1200;
export const MAX_UNARY_TEXT_CHARS = 2000;

/**
 * POST /api/v1/tts/synthesize — speaks a reply and returns a WAV file (Android, the web Listen
 * button). POST /api/v1/tts/synthesize-stream — the same voice as headerless 24 kHz 16-bit mono
 * PCM, sent as it is produced (the web client's spoken replies). Both take `{ text, voice? }` and a
 * Bearer token, and both are limited to 40 requests a minute per account: speech is not charged
 * credits, so that limit and the text caps above are the cost and abuse guard.
 *
 * `provider` knows how the voice is made (see tts/edgeTtsProvider.ts); this route does not. It is
 * `null` when spoken replies are switched off (`TTS_PROVIDER=none`), and the route says so (503)
 * rather than pretending to work (Product Principle #4). The response names the engine in
 * `X-Zarvis-TTS`. A failed voice never touches the reply: this is a separate request, made after
 * the text is already on screen.
 */
export function ttsRouter(provider: TtsProvider | null): Router {
  const router = Router();
  const limit = rateLimit({ name: "tts", windowMs: 60 * 1000, max: 40, keyBy: "account" });

  router.post(
    "/synthesize-stream",
    requireAuth,
    limit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      if (!provider) {
        sendDisabled(res);
        return;
      }
      const { text, voice } = req.body ?? {};
      if (typeof text !== "string" || !text.trim()) {
        res.status(400).json({ error: "text is required" });
        return;
      }

      // Prime the stream before committing the HTTP response. This is important: if synthesis
      // fails before there is any audio, the browser receives a real HTTP error instead of a
      // mysteriously empty or chopped audio stream. Stop synthesizing (and retrying) as soon as
      // the browser cancels this segment.
      const controller = new AbortController();
      const onClose = () => {
        if (!res.writableFinished) controller.abort();
      };
      res.on("close", onClose);
      const iterator = provider.synthesizeStream(text.slice(0, MAX_STREAM_TEXT_CHARS), { voice, signal: controller.signal })[Symbol.asyncIterator]();
      let first: IteratorResult<Buffer>;
      try {
        first = await iterator.next();
      } catch (error) {
        res.off("close", onClose);
        if (controller.signal.aborted) return;
        logFailure("TTS failed before audio", error);
        if (!res.headersSent) sendTtsError(res, error);
        else if (!res.destroyed) res.end();
        return;
      }

      if (first.done || !first.value?.length) {
        res.off("close", onClose);
        logger.error("TTS returned no audio data", { engine: provider.id });
        res.status(502).json({ error: "Voice synthesis returned no audio data.", code: "tts_failed", retryable: true });
        return;
      }

      res.status(200);
      res.set({
        "Content-Type": "audio/l16; codec=pcm; rate=24000",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Zarvis-TTS": `${provider.id}-stream`,
      });
      res.flushHeaders?.();

      const writeChunk = async (chunk: Buffer) => {
        if (res.destroyed || !chunk.length) return;
        if (res.write(chunk)) return;
        // "drain" never fires once the client is gone, so also wake up on "close".
        await new Promise<void>((resolve) => {
          const done = () => {
            res.off("drain", done);
            res.off("close", done);
            resolve();
          };
          res.once("drain", done);
          res.once("close", done);
        });
      };

      try {
        await writeChunk(first.value);
        while (!res.destroyed) {
          const next = await iterator.next();
          if (next.done) break;
          if (next.value?.length) await writeChunk(next.value);
        }
      } catch (error) {
        // Headers and audio may already be on the wire, so a JSON error cannot be sent here. Log
        // the real error and close cleanly; the client stops at the last whole PCM frame instead
        // of receiving a browser-level "network error". (A cancellation is not an error.)
        if (!controller.signal.aborted) logFailure("TTS stream interrupted after audio started", error);
      } finally {
        res.off("close", onClose);
        // Stopped early (client gone): release the upstream connection too.
        await iterator.return?.().catch(() => undefined);
        if (!res.destroyed) res.end();
      }
    }),
  );

  router.post(
    "/synthesize",
    requireAuth,
    limit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      if (!provider) {
        sendDisabled(res);
        return;
      }
      const { text, voice } = req.body ?? {};
      if (typeof text !== "string" || text.trim().length === 0) {
        res.status(400).json({ error: "text is required" });
        return;
      }
      const controller = new AbortController();
      const onClose = () => {
        if (!res.writableFinished) controller.abort();
      };
      res.on("close", onClose);
      let wav: Buffer;
      try {
        wav = await provider.synthesize(text.slice(0, MAX_UNARY_TEXT_CHARS), { voice, signal: controller.signal });
      } catch (error) {
        res.off("close", onClose);
        if (controller.signal.aborted) return;
        logFailure("TTS synthesis failed", error);
        sendTtsError(res, error);
        return;
      }
      res.off("close", onClose);
      res.set({ "Content-Type": "audio/wav", "X-Zarvis-TTS": provider.id });
      res.send(wav);
    }),
  );

  return router;
}

/** What stopped a voice, for whoever reads the log: the kind, our message, and the system error under it (never the text spoken). */
function logFailure(message: string, error: unknown): void {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message.slice(0, 200) : undefined;
  logger.error(message, {
    ...(error instanceof TtsProviderError ? { kind: error.kind } : {}),
    error: error instanceof Error ? error.message.slice(0, 200) : String(error),
    ...(cause ? { cause } : {}),
  });
}

function sendDisabled(res: Response): void {
  res.status(503).json({ error: "Spoken replies are turned off on this server (TTS_PROVIDER=none).", code: "tts_disabled" });
}

/**
 * What a failed voice looks like to a client. The reply itself is already shown as text, so every
 * message says that; none carries anything the service said.
 */
function sendTtsError(res: Response, error: unknown): void {
  if (error instanceof TtsProviderError) {
    switch (error.kind) {
      case "INVALID_REQUEST":
        res.status(400).json({ error: "There is nothing to say in this text.", code: "tts_invalid_request" });
        return;
      case "TIMEOUT":
        res.status(504).json({ error: "Voice synthesis timed out. The reply is still shown as text.", code: "tts_timeout", retryable: true });
        return;
      case "UNAVAILABLE":
        if (error.retryAfterMs) res.setHeader("Retry-After", String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))));
        res.status(503).json({ error: "Voice synthesis isn't available right now. The reply is still shown as text.", code: "tts_unavailable", retryable: true });
        return;
      default:
        res.status(502).json({ error: "Voice synthesis failed. The reply is still shown as text.", code: "tts_failed", retryable: error.retryable });
        return;
    }
  }
  res.status(502).json({ error: "Voice synthesis failed. The reply is still shown as text.", code: "tts_failed", retryable: true });
}
