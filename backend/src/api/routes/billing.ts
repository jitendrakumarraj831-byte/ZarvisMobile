import { Router } from "express";
import type { EntitlementLevel } from "../../domain/types.js";
import type { PlayBillingVerifier } from "../../billing/playBillingVerifier.js";
import type { Store } from "../../store/store.js";
import type { PaymentService } from "../../billing/paymentService.js";
import { PaymentError } from "../../billing/paymentService.js";
import { logger } from "../../security/redact.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";

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
export function billingRouter(verifier: PlayBillingVerifier, store: Store, payments: PaymentService): Router {
  const router = Router();
  const orderLimit = rateLimit({ name: "billing-orders", windowMs: 60 * 1000, max: 10, keyBy: "account" });
  const verifyLimit = rateLimit({ name: "billing-verify", windowMs: 60 * 1000, max: 20, keyBy: "account" });
  const webhookLimit = rateLimit({ name: "billing-webhook", windowMs: 60 * 1000, max: 120, keyBy: "ip" });

  /** Plans, prices (INR) and whether payments are switched on. Prices are server-side only. */
  router.get(
    "/plans",
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      res.json(await payments.catalogue(req.auth!.accountId));
    }),
  );

  /** Creates a Razorpay order for a plan key (the client never sends an amount). */
  router.post(
    "/orders",
    requireAuth,
    orderLimit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      try {
        res.json(await payments.createOrder(req.auth!.accountId, req.body?.planKey));
      } catch (error) {
        sendPaymentError(res, error);
      }
    }),
  );

  /** Checkout success callback: verifies the signature and the payment with Razorpay, then grants the plan once. */
  router.post(
    "/verify",
    requireAuth,
    verifyLimit,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { orderId, paymentId, signature } = req.body ?? {};
      try {
        res.json(await payments.confirmCheckout(req.auth!.accountId, orderId, paymentId, signature));
      } catch (error) {
        sendPaymentError(res, error);
      }
    }),
  );

  /** Razorpay webhook: grants a purchase whose tab closed after paying. Public, but never trusts its body. */
  router.post(
    "/razorpay/webhook",
    webhookLimit,
    asyncHandler(async (req, res) => {
      try {
        const granted = await payments.handleWebhook({
          rawBody: (req as unknown as { rawBody?: Buffer }).rawBody,
          signature: req.header("x-razorpay-signature") ?? undefined,
          body: req.body,
        });
        res.json({ ok: true, granted });
      } catch (error) {
        if (error instanceof PaymentError && error.status < 500) {
          res.status(error.status).json({ error: error.message, code: error.code });
          return;
        }
        logger.error("Razorpay webhook failed", { error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
        // 5xx makes Razorpay retry later.
        res.status(500).json({ error: "Webhook could not be processed", code: "webhook_failed" });
      }
    }),
  );

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
      const claimed = await store.claimPurchaseToken(purchaseToken, req.auth!.accountId, productId);
      if (!claimed) {
        res.status(409).json({ error: "Purchase token has already been used" });
        return;
      }
      const account = await store.updateAccountPlan(req.auth!.accountId, plan);
      res.json({ acknowledged: true, verification, account: { id: account.id, plan: account.plan } });
    }),
  );

  return router;
}

function sendPaymentError(res: import("express").Response, error: unknown): void {
  if (error instanceof PaymentError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  throw error;
}
