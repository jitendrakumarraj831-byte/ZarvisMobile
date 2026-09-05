import { Router } from "express";
import type { SkillRegistry } from "../../tooling/skillRegistry.js";
import type { UsagePort } from "../../tooling/ports.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";

/**
 * POST /api/v1/usage/charge — lets an on-device skill execution (which ran through the
 * Android domain module's own ToolPipeline, see ARCHITECTURE.md "Backend/Android parity
 * note") report a completed, verified, billable action so the server-authoritative credit
 * ledger stays accurate. The cost is looked up from the server's own skill registry by
 * `skillId` — never taken from the client — so a modified client cannot under-report cost.
 * No currently-shipped on-device skill has a non-zero usage cost (see SKILLS.md), so this
 * route exists ahead of need rather than being left unimplemented once one does.
 */
export function usageRouter(registry: SkillRegistry, usagePort: UsagePort): Router {
  const router = Router();

  router.post(
    "/charge",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { skillId } = req.body ?? {};
      if (typeof skillId !== "string") {
        res.status(400).json({ error: "skillId is required" });
        return;
      }
      const skill = registry.find(skillId);
      if (!skill) {
        res.status(404).json({ error: `Unknown skill '${skillId}'` });
        return;
      }
      if (!skill.executesOnDevice) {
        res.status(400).json({ error: `'${skillId}' is backend-executed and is charged automatically, not via this route` });
        return;
      }
      const balance = await usagePort.charge(req.auth!.accountId, skill.usageCost, skillId);
      res.json({ balance });
    }),
  );

  return router;
}
