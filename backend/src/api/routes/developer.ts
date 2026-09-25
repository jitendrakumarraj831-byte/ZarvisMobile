import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { ToolPipeline } from "../../tooling/toolPipeline.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";

/**
 * POST /api/v1/developer/analyze — deterministic entry point into the Developer Agent's
 * read-only repository analysis (DEVELOPER_AGENT.md), for a Developer Mode UI that already
 * knows exactly which skill it wants rather than routing through NLU intent matching.
 * POST /implement is the write-capable, confirmation-gated implementation stage. It creates a branch and PR; it never auto-merges.
 */
export function developerRouter(pipeline: ToolPipeline): Router {
  const router = Router();

  router.post(
    "/analyze",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
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
    }),
  );

  router.post(
    "/implement",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { repoUrl, requirement, confirmed } = req.body ?? {};
      if (typeof repoUrl !== "string" || typeof requirement !== "string" || !repoUrl.trim() || !requirement.trim()) {
        res.status(400).json({ error: "repoUrl and requirement are required" });
        return;
      }
      const outcome = await pipeline.execute(
        { id: randomUUID(), skillId: "developer.implement", input: { values: { repoUrl, requirement } } },
        { accountId: req.auth!.accountId, confirmed: confirmed === true },
      );
      res.json(outcome);
    }),
  );

  return router;
}
