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
