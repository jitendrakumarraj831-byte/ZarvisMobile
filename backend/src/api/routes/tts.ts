import { Router } from "express";
import type { GeminiTtsProvider } from "../../ai/geminiTts.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";

/**
 * POST /api/v1/tts/synthesize — speaks a reply using Gemini's native audio voice (see
 * ai/geminiTts.ts) instead of the browser's built-in speechSynthesis. `provider` is `null`
 * when `GEMINI_API_KEY` isn't configured; the route says so honestly (503) rather than
 * pretending to work (Product Principle #4).
 */
export function ttsRouter(provider: GeminiTtsProvider | null): Router {
  const router = Router();

  router.post(
    "/synthesize-stream",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      if (!provider) {
        res.status(503).json({ error: "Live voice synthesis isn't configured on this server (GEMINI_API_KEY missing)." });
        return;
      }
      const { text } = req.body ?? {};
      if (typeof text !== "string" || !text.trim()) {
        res.status(400).json({ error: "text is required" });
        return;
      }

      // Prime the Gemini stream before committing the HTTP response. This is important:
      // if Gemini returns 401/403/429/5xx before producing audio, the browser receives a
      // real HTTP error instead of a mysteriously destroyed/chopped audio stream.
      const iterator = provider.streamSynthesize(text.slice(0, 1200))[Symbol.asyncIterator]();
      let first: IteratorResult<Buffer>;
      try {
        first = await iterator.next();
      } catch (error) {
        console.error("[tts] Gemini synthesis failed before audio:", error);
        if (!res.headersSent) {
          res.status(502).json({ error: "Gemini TTS synthesis failed. Please try again." });
        } else if (!res.destroyed) {
          res.end();
        }
        return;
      }

      if (first.done || !first.value?.length) {
        console.error("[tts] Gemini returned no audio data");
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
        await new Promise<void>((resolve) => res.once("drain", resolve));
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
        console.error("[tts] Gemini stream interrupted after audio started:", error);
      } finally {
        if (!res.destroyed) res.end();
      }
    }),
  );

  router.post(
    "/synthesize",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      if (!provider) {
        res.status(503).json({ error: "Live voice synthesis isn't configured on this server (GEMINI_API_KEY missing)." });
        return;
      }
      const { text } = req.body ?? {};
      if (typeof text !== "string" || text.trim().length === 0) {
        res.status(400).json({ error: "text is required" });
        return;
      }
      // No usage/credit ledger entry is charged for this call yet (see SUBSCRIPTIONS.md) —
      // this length cap is the only cost guard in this pass, not a real entitlement check.
      const wav = await provider.synthesize(text.slice(0, 2000));
      res.set("Content-Type", "audio/wav");
      res.send(wav);
    }),
  );

  return router;
}
