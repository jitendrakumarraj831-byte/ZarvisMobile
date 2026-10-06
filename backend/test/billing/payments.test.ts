import { createHmac } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildContainer } from "../../src/container.js";
import { PaymentError, PaymentService } from "../../src/billing/paymentService.js";
import { StoreEntitlementPort } from "../../src/billing/entitlements.js";
import { RazorpayClient } from "../../src/billing/razorpay.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";

const KEY = "rzp_test_abc";
const SECRET = "key-secret";
const WEBHOOK_SECRET = "webhook-secret";
const DAY = 24 * 60 * 60 * 1000;

interface FakePayment { id: string; order_id: string; status: string; amount: number; currency: string }

/** A stand-in for api.razorpay.com. */
function fakeRazorpay() {
  const orders = new Map<string, { id: string; amount: number; currency: string; status: string }>();
  const payments = new Map<string, FakePayment>();
  const calls: string[] = [];
  let seq = 0;
  const handler = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace("/v1", "");
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path}`);
    expect(new Headers(init?.headers).get("authorization")).toBe("Basic " + Buffer.from(`${KEY}:${SECRET}`).toString("base64"));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (method === "POST" && path === "/orders") {
      const body = JSON.parse(String(init!.body));
      const order = { id: `order_${(seq += 1)}`, amount: body.amount, currency: body.currency, status: "created" };
      orders.set(order.id, order);
      return json(order);
    }
    const capture = path.match(/^\/payments\/(.+)\/capture$/);
    if (method === "POST" && capture) {
      const p = payments.get(capture[1]!)!;
      p.status = "captured";
      return json(p);
    }
    const one = path.match(/^\/payments\/([^/]+)$/);
    if (one) return payments.has(one[1]!) ? json(payments.get(one[1]!)) : json({ error: { description: "not found" } }, 404);
    const forOrder = path.match(/^\/orders\/([^/]+)\/payments$/);
    if (forOrder) return json({ items: [...payments.values()].filter((p) => p.order_id === forOrder[1]) });
    return json({ error: { description: "unexpected" } }, 500);
  });
  return {
    handler, calls, orders,
    addPayment(p: FakePayment) { payments.set(p.id, p); },
  };
}

const sign = (orderId: string, paymentId: string) => createHmac("sha256", SECRET).update(`${orderId}|${paymentId}`).digest("hex");

describe("Razorpay plan purchases", () => {
  let store: InMemoryStore;
  let gateway: ReturnType<typeof fakeRazorpay>;
  let service: PaymentService;
  let accountId: string;
  let now: Date;

  beforeEach(async () => {
    store = new InMemoryStore();
    gateway = fakeRazorpay();
    vi.stubGlobal("fetch", gateway.handler);
    now = new Date("2026-10-05T10:00:00Z");
    service = new PaymentService(store, new RazorpayClient(KEY, SECRET, WEBHOOK_SECRET), () => now);
    const user = await store.createUser("buyer@example.com", "x");
    accountId = (await store.createAccountForUser(user.id)).id;
  });
  afterEach(() => vi.unstubAllGlobals());

  async function buy(planKey = "pro_monthly", paymentId = "pay_1") {
    const order = await service.createOrder(accountId, planKey);
    gateway.addPayment({ id: paymentId, order_id: order.orderId, status: "captured", amount: order.amountPaise, currency: "INR" });
    return { order, paymentId };
  }

  it("reports payments as unavailable (503) when Razorpay is not configured", async () => {
    const off = new PaymentService(store, null);
    expect((await off.catalogue(accountId)).paymentsEnabled).toBe(false);
    await expect(off.createOrder(accountId, "pro_monthly")).rejects.toMatchObject({ code: "payments_unavailable", status: 503 });
  });

  it("prices come from the server: ₹499 monthly / ₹4,999 yearly, never from the client", async () => {
    const catalogue = await service.catalogue(accountId);
    expect(catalogue).toMatchObject({ currency: "INR", paymentsEnabled: true, testMode: true });
    expect(catalogue.plans.map((p) => [p.key, p.amountInr])).toEqual([["pro_monthly", 499], ["pro_yearly", 4999]]);
    expect(catalogue.plans[1]!.savingsPercent).toBe(17);

    const order = await service.createOrder(accountId, "pro_monthly");
    expect(order).toMatchObject({ amountPaise: 49900, currency: "INR", keyId: KEY });
    expect(gateway.orders.get(order.orderId)!.amount).toBe(49900);
    await expect(service.createOrder(accountId, "pro_free_forever")).rejects.toMatchObject({ code: "unknown_plan" });
    await expect(service.createOrder(accountId, undefined)).rejects.toMatchObject({ code: "unknown_plan" });
  });

  it("rejects a forged signature and grants nothing", async () => {
    const { order, paymentId } = await buy();
    await expect(service.confirmCheckout(accountId, order.orderId, paymentId, "0".repeat(64))).rejects.toMatchObject({ code: "invalid_signature", status: 400 });
    const account = await store.getAccount(accountId);
    expect(account!.plan).not.toBe("PRO");
    expect(await store.getCreditBalance(accountId)).toBe(50);
  });

  it("grants Pro for 30 days plus credits once, and a replay changes nothing", async () => {
    const { order, paymentId } = await buy();
    const first = await service.confirmCheckout(accountId, order.orderId, paymentId, sign(order.orderId, paymentId));
    expect(first).toMatchObject({ plan: "PRO", creditBalance: 1050, alreadyActive: false });
    expect(first.planExpiresAt!.getTime()).toBe(now.getTime() + 30 * DAY);

    const replay = await service.confirmCheckout(accountId, order.orderId, paymentId, sign(order.orderId, paymentId));
    expect(replay).toMatchObject({ plan: "PRO", creditBalance: 1050, alreadyActive: true });
  });

  it("an order belongs to its account: another account sees it as missing", async () => {
    const { order, paymentId } = await buy();
    const other = await store.createUser("other@example.com", "x");
    const otherAccount = await store.createAccountForUser(other.id);
    await expect(service.confirmCheckout(otherAccount.id, order.orderId, paymentId, sign(order.orderId, paymentId))).rejects.toMatchObject({ code: "order_not_found", status: 404 });
    expect((await store.getAccount(otherAccount.id))!.plan).not.toBe("PRO");
  });

  it("refuses a payment whose amount or order does not match, even with a valid signature", async () => {
    const order = await service.createOrder(accountId, "pro_yearly");
    gateway.addPayment({ id: "pay_cheap", order_id: order.orderId, status: "captured", amount: 100, currency: "INR" });
    await expect(service.confirmCheckout(accountId, order.orderId, "pay_cheap", sign(order.orderId, "pay_cheap"))).rejects.toMatchObject({ code: "payment_mismatch" });
    gateway.addPayment({ id: "pay_other", order_id: "order_zzz", status: "captured", amount: order.amountPaise, currency: "INR" });
    await expect(service.confirmCheckout(accountId, order.orderId, "pay_other", sign(order.orderId, "pay_other"))).rejects.toMatchObject({ code: "payment_mismatch" });
    expect((await store.getAccount(accountId))!.plan).not.toBe("PRO");
  });

  it("captures an authorized payment before granting, and refuses one that failed", async () => {
    const order = await service.createOrder(accountId, "pro_monthly");
    gateway.addPayment({ id: "pay_auth", order_id: order.orderId, status: "authorized", amount: order.amountPaise, currency: "INR" });
    await service.confirmCheckout(accountId, order.orderId, "pay_auth", sign(order.orderId, "pay_auth"));
    expect(gateway.calls).toContain("POST /payments/pay_auth/capture");
    expect((await store.getAccount(accountId))!.plan).toBe("PRO");

    const second = await service.createOrder(accountId, "pro_monthly");
    gateway.addPayment({ id: "pay_failed", order_id: second.orderId, status: "failed", amount: second.amountPaise, currency: "INR" });
    await expect(service.confirmCheckout(accountId, second.orderId, "pay_failed", sign(second.orderId, "pay_failed"))).rejects.toMatchObject({ code: "payment_not_captured", status: 402 });
  });

  it("renewing early stacks onto the running period; yearly grants 365 days", async () => {
    const a = await buy("pro_monthly", "pay_a");
    await service.confirmCheckout(accountId, a.order.orderId, a.paymentId, sign(a.order.orderId, a.paymentId));
    const b = await buy("pro_yearly", "pay_b");
    const result = await service.confirmCheckout(accountId, b.order.orderId, b.paymentId, sign(b.order.orderId, b.paymentId));
    expect(result.planExpiresAt!.getTime()).toBe(now.getTime() + (30 + 365) * DAY);
    expect(result.creditBalance).toBe(50 + 1000 + 12000);
  });

  it("a lapsed Pro period reads as FREE in the entitlement snapshot", async () => {
    const { order, paymentId } = await buy();
    await service.confirmCheckout(accountId, order.orderId, paymentId, sign(order.orderId, paymentId));
    const port = new StoreEntitlementPort(store);
    expect((await port.snapshot(accountId)).plan).toBe("PRO");
    const account = (await store.getAccount(accountId))!;
    // Rewind the stored expiry into the past.
    vi.setSystemTime(new Date(account.planExpiresAt!.getTime() + DAY));
    try {
      expect((await port.snapshot(accountId)).plan).toBe("FREE");
    } finally {
      vi.useRealTimers();
    }
  });

  describe("webhook", () => {
    const body = (orderId: string, event = "payment.captured") => ({ event, payload: { payment: { entity: { order_id: orderId } } } });
    const raw = (b: unknown) => Buffer.from(JSON.stringify(b));
    const whSig = (buf: Buffer) => createHmac("sha256", WEBHOOK_SECRET).update(buf).digest("hex");

    it("rejects a bad signature when the raw body is available", async () => {
      const { order } = await buy();
      const buf = raw(body(order.orderId));
      await expect(service.handleWebhook({ rawBody: buf, signature: "bad", body: body(order.orderId) })).rejects.toMatchObject({ code: "invalid_signature" });
      expect((await store.getAccount(accountId))!.plan).not.toBe("PRO");
    });

    it("grants a purchase whose tab closed after paying, exactly once", async () => {
      const { order } = await buy();
      const b = body(order.orderId);
      const buf = raw(b);
      expect(await service.handleWebhook({ rawBody: buf, signature: whSig(buf), body: b })).toBe(true);
      expect(await service.handleWebhook({ rawBody: buf, signature: whSig(buf), body: b })).toBe(false);
      expect((await store.getAccount(accountId))!.plan).toBe("PRO");
      expect(await store.getCreditBalance(accountId)).toBe(1050);
    });

    it("never trusts the body: a webhook for an unpaid order grants nothing", async () => {
      const order = await service.createOrder(accountId, "pro_monthly"); // no payment exists at Razorpay
      const b = body(order.orderId);
      const buf = raw(b);
      expect(await service.handleWebhook({ rawBody: buf, signature: whSig(buf), body: b })).toBe(false);
      expect(await service.handleWebhook({ body: body("order_not_ours") })).toBe(false);
      expect((await store.getAccount(accountId))!.plan).not.toBe("PRO");
    });

    it("the client verify and the webhook racing grant the plan only once", async () => {
      const { order, paymentId } = await buy();
      const b = body(order.orderId);
      const buf = raw(b);
      await Promise.all([
        service.confirmCheckout(accountId, order.orderId, paymentId, sign(order.orderId, paymentId)),
        service.handleWebhook({ rawBody: buf, signature: whSig(buf), body: b }),
        service.handleWebhook({ rawBody: buf, signature: whSig(buf), body: b }),
      ]);
      expect(await store.getCreditBalance(accountId)).toBe(1050);
    });
  });

  describe("HTTP", () => {
    it("billing routes need a session; plans/orders work when authenticated", async () => {
      const container = buildContainer(store);
      const app = buildServer({ ...container, paymentService: service });
      expect((await request(app).get("/api/v1/billing/plans")).status).toBe(401);
      expect((await request(app).post("/api/v1/billing/orders").send({ planKey: "pro_monthly" })).status).toBe(401);
      expect((await request(app).post("/api/v1/billing/verify").send({})).status).toBe(401);

      const signup = await request(app).post("/api/v1/auth/signup").send({ email: "http@example.com", password: "password123" });
      const auth = { authorization: `Bearer ${signup.body.accessToken}` };
      const plans = await request(app).get("/api/v1/billing/plans").set(auth);
      expect(plans.status).toBe(200);
      expect(plans.body.plans[0]).toMatchObject({ key: "pro_monthly", amountInr: 499 });

      const order = await request(app).post("/api/v1/billing/orders").set(auth).send({ planKey: "pro_monthly", amountPaise: 1 });
      expect(order.status).toBe(200);
      expect(order.body.amountPaise).toBe(49900); // the client-sent amount is ignored
      const bad = await request(app).post("/api/v1/billing/orders").set(auth).send({ planKey: "nope" });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe("unknown_plan");
    });

    it("the webhook route verifies a signature over the exact raw bytes", async () => {
      const container = buildContainer(store);
      const app = buildServer({ ...container, paymentService: service });
      const user = await store.createUser("wh@example.com", "x");
      const acct = await store.createAccountForUser(user.id);
      const order = await service.createOrder(acct.id, "pro_monthly");
      gateway.addPayment({ id: "pay_wh", order_id: order.orderId, status: "captured", amount: order.amountPaise, currency: "INR" });
      const payload = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { order_id: order.orderId } } } });
      const bad = await request(app).post("/api/v1/billing/razorpay/webhook").set("content-type", "application/json").set("x-razorpay-signature", "nope").send(payload);
      expect(bad.status).toBe(400);
      const good = await request(app).post("/api/v1/billing/razorpay/webhook").set("content-type", "application/json")
        .set("x-razorpay-signature", createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")).send(payload);
      expect(good.status).toBe(200);
      expect(good.body).toEqual({ ok: true, granted: true });
      expect((await store.getAccount(acct.id))!.plan).toBe("PRO");
    });
  });

  it("PaymentError carries a stable code and HTTP status", () => {
    const error = new PaymentError("invalid_signature", 400, "x");
    expect([error.code, error.status]).toEqual(["invalid_signature", 400]);
  });
});
