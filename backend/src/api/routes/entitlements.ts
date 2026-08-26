import { Router } from "express";
import type { EntitlementPort } from "../../tooling/ports.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";

/** GET /api/v1/entitlements/me — resolved plan/usage snapshot. See SUBSCRIPTIONS.md. */
export function entitlementsRouter(entitlementPort: EntitlementPort): Router {
  const router = Router();

  router.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
    const snapshot = await entitlementPort.snapshot(req.auth!.accountId);
    res.json(snapshot);
  });

  return router;
}
