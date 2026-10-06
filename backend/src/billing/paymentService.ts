import { randomBytes } from "node:crypto";
import type { Store } from "../store/store.js";
import { describePlan, findPaidPlan, paidPlans } from "./plans.js";
import { RazorpayClient, RazorpayError, type RazorpayPayment } from "./razorpay.js";

export type PaymentErrorCode =
  | "payments_unavailable"
  | "unknown_plan"
  | "order_not_found"
  | "invalid_signature"
  | "payment_mismatch"
  | "payment_not_captured"
  | "gateway_error";

export class PaymentError extends Error {
  constructor(readonly code: PaymentErrorCode, readonly status: number, message: string) {
    super(message);
    this.name = "PaymentError";
  }
}

export interface PlanSummary {
  plan: string;
  planExpiresAt: Date | null;
  creditBalance: number;
}

/**
 * Plan purchases through Razorpay. The flow is order → Checkout (UPI/cards/netbanking/wallets)
 * → verify, with the webhook as the safety net when the tab closes after paying. Every path
 * ends in [Store.fulfillPaymentOrder], which grants the plan exactly once. The amount is always
 * the server's, and Razorpay is asked for the payment's real state before anything is granted.
 */
export class PaymentService {
  constructor(
    private readonly store: Store,
    private readonly razorpay: RazorpayClient | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get enabled(): boolean {
    return this.razorpay !== null;
  }

  async catalogue(accountId: string) {
    const account = await this.store.getAccount(accountId);
    const lapsed = !!account?.planExpiresAt && account.planExpiresAt.getTime() <= this.now().getTime() && account.plan === "PRO";
    return {
      currency: "INR" as const,
      paymentsEnabled: this.enabled,
      testMode: this.razorpay?.isTestMode ?? false,
      methods: ["UPI", "Cards", "Netbanking", "Wallets"],
      plans: paidPlans().map(describePlan),
      current: {
        plan: lapsed ? "FREE" : (account?.plan ?? "FREE"),
        planExpiresAt: account?.planExpiresAt ?? null,
        creditBalance: await this.store.getCreditBalance(accountId),
      },
    };
  }

  async createOrder(accountId: string, planKey: unknown) {
    if (!this.razorpay) throw new PaymentError("payments_unavailable", 503, "Payments are not enabled on this server yet.");
    const plan = findPaidPlan(planKey);
    if (!plan) throw new PaymentError("unknown_plan", 400, "Unknown plan.");
    const receipt = "zv_" + randomBytes(9).toString("hex");
    let order;
    try {
      order = await this.razorpay.createOrder({ amountPaise: plan.amountPaise, receipt, notes: { accountId, planKey: plan.key } });
    } catch (error) {
      throw gateway(error);
    }
    if (order.amount !== plan.amountPaise || order.currency !== "INR") {
      throw new PaymentError("payment_mismatch", 502, "The payment gateway returned an unexpected order.");
    }
    await this.store.createPaymentOrder({
      orderId: order.id,
      accountId,
      planKey: plan.key,
      amountPaise: plan.amountPaise,
      currency: "INR",
      periodDays: plan.periodDays,
      credits: plan.credits,
      status: "created",
      createdAt: this.now(),
    });
    return {
      orderId: order.id,
      keyId: this.razorpay.keyId,
      amountPaise: plan.amountPaise,
      currency: "INR" as const,
      planKey: plan.key,
      description: `ZARVIS Pro — ${plan.period === "yearly" ? "1 year" : "30 days"}`,
      testMode: this.razorpay.isTestMode,
    };
  }

  /** Called by the browser after Checkout succeeds. Returns the account's new plan summary. */
  async confirmCheckout(accountId: string, orderId: unknown, paymentId: unknown, signature: unknown): Promise<PlanSummary & { alreadyActive: boolean }> {
    if (!this.razorpay) throw new PaymentError("payments_unavailable", 503, "Payments are not enabled on this server yet.");
    if (typeof orderId !== "string" || typeof paymentId !== "string" || typeof signature !== "string") {
      throw new PaymentError("invalid_signature", 400, "orderId, paymentId and signature are required.");
    }
    const order = await this.store.getPaymentOrder(orderId);
    // Someone else's order looks exactly like a missing one.
    if (!order || order.accountId !== accountId) throw new PaymentError("order_not_found", 404, "Order not found.");
    if (order.status === "paid") return { ...(await this.summary(accountId)), alreadyActive: true };
    if (!this.razorpay.verifyPaymentSignature(orderId, paymentId, signature)) {
      throw new PaymentError("invalid_signature", 400, "The payment signature did not verify.");
    }
    let payment: RazorpayPayment;
    try {
      payment = await this.razorpay.fetchPayment(paymentId);
      if (payment.status === "authorized") payment = await this.razorpay.capturePayment(paymentId, order.amountPaise);
    } catch (error) {
      throw gateway(error);
    }
    if (payment.order_id !== orderId || payment.amount !== order.amountPaise || payment.currency !== "INR") {
      throw new PaymentError("payment_mismatch", 400, "The payment does not match this order.");
    }
    if (payment.status !== "captured") throw new PaymentError("payment_not_captured", 402, "The payment has not completed.");
    const result = await this.store.fulfillPaymentOrder(orderId, paymentId, this.now());
    if (result.status === "not_found") throw new PaymentError("order_not_found", 404, "Order not found.");
    return { ...(await this.summary(accountId)), alreadyActive: result.status === "already_fulfilled" };
  }

  /**
   * Razorpay webhook (payment.captured / order.paid). The body is never trusted: when the raw
   * bytes are available and a webhook secret is set the signature is checked, and in every case
   * the payment's real state is read back from Razorpay before anything is granted.
   * Returns true when a purchase was granted by this call.
   */
  async handleWebhook(input: { rawBody?: Buffer; signature?: string; body: unknown }): Promise<boolean> {
    if (!this.razorpay) throw new PaymentError("payments_unavailable", 503, "Payments are not enabled.");
    if (this.razorpay.hasWebhookSecret && input.rawBody) {
      if (!input.signature || !this.razorpay.verifyWebhookSignature(input.rawBody, input.signature)) {
        throw new PaymentError("invalid_signature", 400, "Invalid webhook signature.");
      }
    }
    const body = (input.body ?? {}) as { event?: string; payload?: { payment?: { entity?: { order_id?: string } }; order?: { entity?: { id?: string } } } };
    if (body.event !== "payment.captured" && body.event !== "order.paid") return false;
    const orderId = body.payload?.payment?.entity?.order_id ?? body.payload?.order?.entity?.id;
    if (typeof orderId !== "string") return false;
    const order = await this.store.getPaymentOrder(orderId);
    if (!order || order.status === "paid") return false;
    let payments: RazorpayPayment[];
    try {
      payments = await this.razorpay.fetchOrderPayments(orderId);
    } catch (error) {
      throw gateway(error);
    }
    const paid = payments.find((p) => p.status === "captured" && p.amount === order.amountPaise && p.currency === "INR");
    if (!paid) return false;
    const result = await this.store.fulfillPaymentOrder(orderId, paid.id, this.now());
    return result.status === "fulfilled";
  }

  private async summary(accountId: string): Promise<PlanSummary> {
    const account = await this.store.getAccount(accountId);
    return {
      plan: account?.plan ?? "FREE",
      planExpiresAt: account?.planExpiresAt ?? null,
      creditBalance: await this.store.getCreditBalance(accountId),
    };
  }
}

function gateway(error: unknown): PaymentError {
  return new PaymentError("gateway_error", error instanceof RazorpayError && error.status === 504 ? 504 : 502, "The payment gateway could not be reached. Please try again.");
}
