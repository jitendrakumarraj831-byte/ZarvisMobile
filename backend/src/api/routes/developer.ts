import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { ToolPipeline } from "../../tooling/toolPipeline.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";

/**
 * POST /api/v1/developer/analyze — deterministic entry point into the Developer Agent's
 * read-only repository analysis (DEVELOPER_AGENT.md), for a Developer Mode UI that already
 * knows exactly which skill it wants rather than routing through NLU intent matching.
 * Write-capable Developer Agent stages (plan/code/test/PR) are not implemented in this
 * pass — see MASTER_SPEC.md §29.
 */
export function developerRouter(pipeline: ToolPipeline): Router {
  const router = Router();

  router.post("/analyze", requireAuth, async (req: AuthenticatedRequest, res) => {
    const { repoUrl } = req.body ?? {};
    if (typeof repoUrl !== "string" || repoUrl.trim().length === 0) {
      res.status(400).json({ error: "repoUrl is required" });
      return;
    }
    const outcome = await pipeline.execute(
      { id: randomUUID(), skillId: "developer.analyze_repo", input: { values: { repoUrl } } },
      { accountId: req.auth!.accountId },
    );
    res.json(outcome);
  });

  return router;
}
