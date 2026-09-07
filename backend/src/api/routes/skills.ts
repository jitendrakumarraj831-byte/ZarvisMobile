import { Router } from "express";
import { resolveEntitlement } from "../../domain/entitlementResolver.js";
import type { EntitlementPort } from "../../tooling/ports.js";
import type { SkillRegistry } from "../../tooling/skillRegistry.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";

/**
 * GET /api/v1/skills — the live "What can you do?" catalogue (SKILLS.md). Skills above the
 * caller's plan are still listed, marked `upgradeRequired`, rather than hidden — see
 * SKILLS.md "discoverability matters more than upsell pressure".
 */
export function skillsRouter(registry: SkillRegistry, entitlementPort: EntitlementPort): Router {
  const router = Router();

  router.get(
    "/",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const snapshot = await entitlementPort.snapshot(req.auth!.accountId);
      const now = new Date();
      const skills = registry.all().map((skill) => {
        const decision = resolveEntitlement(snapshot, skill, now);
        return {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          category: skill.category,
          riskLevel: skill.riskLevel,
          usageCost: skill.usageCost,
          requiredEntitlement: skill.requiredEntitlement,
          executesOnDevice: skill.executesOnDevice,
          upgradeRequired: !decision.allowed,
        };
      });
      res.json({ skills });
    }),
  );

  return router;
}
