import { Router } from "express";
import type { PlayBillingVerifier } from "../../billing/playBillingVerifier.js";

/** POST /api/v1/billing/webhook — Play Billing verification callback. See SUBSCRIPTIONS.md. */
export function billingRouter(verifier: PlayBillingVerifier): Router {
  const router = Router();

  router.post("/webhook", async (req, res) => {
    const { purchaseToken, productId } = req.body ?? {};
    if (typeof purchaseToken !== "string" || typeof productId !== "string") {
      res.status(400).json({ error: "purchaseToken and productId are required" });
      return;
    }
    const verification = await verifier.verifyPurchaseToken(purchaseToken, productId);
    if (!verification.valid) {
      res.status(422).json({ error: "Purchase token could not be verified" });
      return;
    }
    // A real implementation would update the account's plan/subscription record here.
    res.json({ acknowledged: true, verification });
  });

  return router;
}
