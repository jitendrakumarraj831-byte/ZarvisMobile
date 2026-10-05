# ZARVIS Subscriptions

Subscription and credit behavior must remain truthful and server-authoritative.

## Principles

- Never trust client-side credit state.
- Sensitive billing operations require server-side validation.
- Purchases should be safely idempotent/single-use where applicable.
- Account ownership must be enforced.
- Entitlements must match the server's actual state.
- UI must not advertise unavailable capabilities as active.

## Product tiers

Specific pricing, limits and entitlements should be defined from the current production billing configuration rather than duplicated as stale constants in documentation.

See [ZARVIS_MASTER_PRODUCT_BLUEPRINT.md](./ZARVIS_MASTER_PRODUCT_BLUEPRINT.md) for product rules.

## Paid plans in India: UPI, cards, netbanking, wallets (Razorpay)

Pro is sold as a one-time payment per period (30 days or 1 year, no auto-renew), in INR, through
[Razorpay Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/).
Everything that decides money lives on the server (`backend/src/billing/`):

| Piece | What it does |
|---|---|
| `plans.ts` | The catalogue: `pro_monthly` (default ₹499, 30 days, 1,000 credits) and `pro_yearly` (default ₹4,999, 365 days, 12,000 credits). The client sends a plan key, never an amount. |
| `razorpay.ts` | REST client (no SDK): create order, read/capture payment, verify the checkout signature and the webhook signature (HMAC-SHA256, timing-safe). |
| `paymentService.ts` | `order → Checkout → verify` plus the webhook safety net. Every path ends in `Store.fulfillPaymentOrder`, which grants the plan **exactly once**. |
| `Store.fulfillPaymentOrder` | One atomic step (Postgres: row-locked transaction): mark the order paid, set `plan = PRO` with `plan_expires_at` (stacking onto a running period), add the credits. |

Endpoints (`/api/v1/billing`): `GET /plans`, `POST /orders`, `POST /verify`, `POST /razorpay/webhook`
(public, rate-limited; never trusts its body). A lapsed `plan_expires_at` reads as FREE in the
entitlement snapshot; the `plan` column is not rewritten.

### Safety properties (covered by `test/billing/payments.test.ts` and `test/store/postgresStore.test.ts`)

- Price, period and credits are server-side; a forged amount or plan is ignored/rejected.
- A forged or replayed signature, an order that belongs to another account, a payment whose amount or
  order id differs, or a payment that is not captured grants nothing.
- Authorized payments are captured before granting. The payment's real state is always read back
  from Razorpay (also for the webhook), so a fake webhook cannot grant anything.
- Client verify and webhook racing, or retries, grant the plan and credits once.
- Deleting an account deletes its payment orders.

### Setting it up

1. Create a Razorpay account and complete KYC; Razorpay also reviews that the website shows Terms,
   Privacy, Refund/Cancellation and Contact pages. Pick test mode first (`rzp_test_*` keys).
2. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` on the server (Vercel env).
   Optionally tune `PRICE_PRO_MONTHLY_INR`, `PRICE_PRO_YEARLY_INR`, `PRO_CREDITS_MONTHLY`, `PRO_CREDITS_YEARLY`.
3. In Razorpay Dashboard → Webhooks add `https://<your-domain>/api/v1/billing/razorpay/webhook`
   with the events `payment.captured` and `order.paid`, using the same secret.
4. Open Plans in the app: with keys set the page shows "Test mode" (test keys) and the Upgrade button;
   without keys it says payments are not enabled.

Not handled yet (needs a product decision): auto-renewing subscriptions (Razorpay Subscriptions / UPI
AutoPay), refunds from inside the app, GST invoices, and coupons. Check GST and invoicing requirements with an accountant.
