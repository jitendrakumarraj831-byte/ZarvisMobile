import { Router } from "express";
import type { EntitlementLevel } from "../../domain/types.js";
import type { PlayBillingVerifier } from "../../billing/playBillingVerifier.js";
import type { Store } from "../../store/store.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";

/**
 * Maps a Play Console subscription product ID to the plan it grants. MASTER_SPEC.md §19
 * activates only FREE/TRIAL/PRO for MVP (PLUS/BUSINESS/ENTERPRISE are modeled in the schema
 * for a later migration-free rollout but have no real product behind them yet), so only PRO
 * product IDs are mapped here — add the others once real products exist in Play Console.
 * Any product ID not listed here is rejected rather than guessed at.
 */
const PRODUCT_ID_TO_PLAN: Record<string, EntitlementLevel> = {
  zarvis_pro_monthly: "PRO",
  zarvis_pro_yearly: "PRO",
};

/** POST /api/v1/billing/webhook — Play Billing verification callback. See SUBSCRIPTIONS.md. */
export function billingRouter(verifier: PlayBillingVerifier, store: Store): Router {
  const router = Router();

  router.post(
    "/webhook",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { purchaseToken, productId } = req.body ?? {};
      if (typeof purchaseToken !== "string" || typeof productId !== "string") {
        res.status(400).json({ error: "purchaseToken and productId are required" });
        return;
      }
      const plan = PRODUCT_ID_TO_PLAN[productId];
      if (!plan) {
        res.status(400).json({ error: `Unrecognized productId '${productId}'` });
        return;
      }
      const verification = await verifier.verifyPurchaseToken(purchaseToken, productId);
      if (!verification.valid) {
        res.status(422).json({ error: "Purchase token could not be verified" });
        return;
      }
      const account = await store.updateAccountPlan(req.auth!.accountId, plan);
      res.json({ acknowledged: true, verification, account: { id: account.id, plan: account.plan } });
    }),
  );

  return router;
}
