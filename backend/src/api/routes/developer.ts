import { randomUUID } from "node:crypto";
import { Router } from "express";
import { explainOutcome } from "../../agents/orchestrator.js";
import type { ToolPipeline } from "../../tooling/toolPipeline.js";
import type { SkillRegistry } from "../../tooling/skillRegistry.js";
import { toStructuredResult } from "../../tooling/toolResult.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";

/**
 * POST /api/v1/developer/analyze — read-only repository analysis.
 * POST /api/v1/developer/implement — always returns `confirmation_required` first; the
 * change only runs after POST /api/v1/confirmations/:id/approve for that exact request.
 */
export function developerRouter(pipeline: ToolPipeline, registry: SkillRegistry): Router {
  const router = Router();
  const limit = rateLimit({ name: "developer", windowMs: 60 * 1000, max: 10, keyBy: "account" });

  router.post(
    "/analyze",
    requireAuth,
    limit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { repoUrl } = req.body ?? {};
      if (typeof repoUrl !== "string" || repoUrl.trim().length === 0) {
        res.status(400).json({ error: "repoUrl is required" });
        return;
      }
      const outcome = await pipeline.execute(
        { id: randomUUID(), skillId: "developer.analyze_repo", input: { values: { repoUrl: repoUrl.trim() } } },
        { accountId: req.auth!.accountId },
      );
      res.json({ ...outcome, structured: toStructuredResult("developer.analyze_repo", registry.find("developer.analyze_repo"), outcome, explainOutcome(outcome)) });
    }),
  );

  router.post(
    "/implement",
    requireAuth,
    limit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { repoUrl, requirement } = req.body ?? {};
      if (typeof repoUrl !== "string" || typeof requirement !== "string" || !repoUrl.trim() || !requirement.trim()) {
        res.status(400).json({ error: "repoUrl and requirement are required" });
        return;
      }
      const outcome = await pipeline.execute(
        {
          id: randomUUID(),
          skillId: "developer.implement",
          input: { values: { repoUrl: repoUrl.trim(), requirement: requirement.trim().slice(0, 4000) } },
        },
        { accountId: req.auth!.accountId },
      );
      res.json({ ...outcome, structured: toStructuredResult("developer.implement", registry.find("developer.implement"), outcome, explainOutcome(outcome)) });
    }),
  );

  return router;
}
