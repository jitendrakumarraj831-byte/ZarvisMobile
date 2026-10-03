import { Router, type Response } from "express";
import { AIProviderError, providerErrorPayload } from "../../ai/geminiErrors.js";
import { resolveGeminiVoice, type GeminiTtsProvider } from "../../ai/geminiTts.js";
import { logger } from "../../security/redact.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";

/**
 * POST /api/v1/tts/synthesize — speaks a reply using Gemini's native audio voice (see
 * ai/geminiTts.ts) instead of the browser's built-in speechSynthesis. `provider` is `null`
 * when `GEMINI_API_KEY` isn't configured; the route says so honestly (503) rather than
 * pretending to work (Product Principle #4).
 */
export function ttsRouter(provider: GeminiTtsProvider | null): Router {
  const router = Router();
  // TTS is not charged credits; this per-account limit is the cost guard against abuse.
  const limit = rateLimit({ name: "tts", windowMs: 60 * 1000, max: 40, keyBy: "account" });

  router.post(
    "/synthesize-stream",
    requireAuth,
    limit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      if (!provider) {
        res.status(503).json({ error: "Live voice synthesis isn't configured on this server (GEMINI_API_KEY missing)." });
        return;
      }
      const { text, voice } = req.body ?? {};
      if (typeof text !== "string" || !text.trim()) {
        res.status(400).json({ error: "text is required" });
        return;
      }
      const selectedVoice = resolveGeminiVoice(voice, provider.defaultVoice);

      // Prime the Gemini stream before committing the HTTP response. This is important:
      // if Gemini returns 401/403/429/5xx before producing audio, the browser receives a
      // real HTTP error instead of a mysteriously destroyed/chopped audio stream.
      // Stop synthesizing (and retrying) as soon as the browser cancels this segment.
      const controller = new AbortController();
      const onClose = () => {
        if (!res.writableFinished) controller.abort();
      };
      res.on("close", onClose);
      const iterator = provider.streamSynthesize(text.slice(0, 1200), selectedVoice, controller.signal)[Symbol.asyncIterator]();
      let first: IteratorResult<Buffer>;
      try {
        first = await iterator.next();
      } catch (error) {
        res.off("close", onClose);
        if (controller.signal.aborted) return;
        logger.error("Gemini TTS failed before audio", { error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
        if (!res.headersSent) sendTtsError(res, error, "Gemini TTS synthesis failed. Please try again.");
        else if (!res.destroyed) res.end();
        return;
      }

      if (first.done || !first.value?.length) {
        logger.error("Gemini TTS returned no audio data");
        res.status(502).json({ error: "Gemini TTS returned no audio data. Please try again." });
        return;
      }

      res.status(200);
      res.set({
        "Content-Type": "audio/l16; codec=pcm; rate=24000",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Zarvis-TTS": "gemini-stream",
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
        // Headers/audio may already be on the wire, so a JSON error cannot be sent here.
        // Log the real Gemini/backend error and close cleanly; the client will stop at the
        // last valid PCM frame instead of receiving a browser-level "network error".
        logger.error("Gemini TTS stream interrupted after audio started", { error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
      } finally {
        res.off("close", onClose);
        // Stopped early (client gone): release the upstream Gemini stream too.
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
        res.status(503).json({ error: "Live voice synthesis isn't configured on this server (GEMINI_API_KEY missing)." });
        return;
      }
      const { text, voice } = req.body ?? {};
      if (typeof text !== "string" || text.trim().length === 0) {
        res.status(400).json({ error: "text is required" });
        return;
      }
      // No usage/credit ledger entry is charged for this call yet (see SUBSCRIPTIONS.md) —
      // this length cap is the only cost guard in this pass, not a real entitlement check.
      let wav: Buffer;
      try {
        wav = await provider.synthesize(text.slice(0, 2000), resolveGeminiVoice(voice, provider.defaultVoice));
      } catch (error) {
        logger.error("Gemini TTS synthesis failed", { error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
        sendTtsError(res, error, "Voice synthesis failed. The reply is still shown as text.");
        return;
      }
      res.set("Content-Type", "audio/wav");
      res.send(wav);
    }),
  );

  return router;
}

/** A quota/rate limit is reported as such (429 + structured code) so the client stops asking
 * for more speech in this turn; any other failure stays a generic retryable 502. */
function sendTtsError(res: Response, error: unknown, message: string): void {
  if (error instanceof AIProviderError && error.code !== "AI_UNAVAILABLE") {
    res.status(429).json(providerErrorPayload(error));
    return;
  }
  res.status(502).json({ error: message, code: "tts_failed", retryable: true });
}
