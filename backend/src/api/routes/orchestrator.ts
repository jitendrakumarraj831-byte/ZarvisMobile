import { Router } from "express";
import type { Orchestrator } from "../../agents/orchestrator.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";

/**
 * POST /api/v1/orchestrator/turn — one conversation turn. See AI_ARCHITECTURE.md and
 * MASTER_SPEC.md §25. Not streamed in this pass (the provider supports `streamGenerate`,
 * but the HTTP route uses the simpler non-streaming `generate` — see AI_ARCHITECTURE.md).
 */
export function orchestratorRouter(orchestrator: Orchestrator): Router {
  const router = Router();

  router.post("/turn", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { utterance, confirmed, locale } = req.body ?? {};
    if (typeof utterance !== "string" || utterance.trim().length === 0) {
      res.status(400).json({ error: "utterance is required" });
      return;
    }
    const result = await orchestrator.runTurn({
      accountId: req.auth!.accountId,
      utterance,
      confirmed: typeof confirmed === "boolean" ? confirmed : undefined,
      locale: typeof locale === "string" ? locale : undefined,
    });
    res.json(result);
  });

  return router;
}
