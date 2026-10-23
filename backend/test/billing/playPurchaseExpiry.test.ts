import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildContainer } from "../../src/container.js";
import { buildServer } from "../../src/server.js";
import type { PlayBillingVerifier } from "../../src/billing/playBillingVerifier.js";
import type { Store } from "../../src/store/store.js";
import { auth, newGuest, STORES } from "../helpers/api.js";

const DAY = 24 * 60 * 60 * 1000;

/** A server whose Play verifier answers "valid until `expiresAt`" (the mock verifier gives no expiry). */
function serverWith(store: Store, verifier?: PlayBillingVerifier) {
  const container = buildContainer(store);
  if (verifier) container.billingVerifier = verifier as typeof container.billingVerifier;
  return buildServer(container);
}

const validUntil = (expiresAt: Date): PlayBillingVerifier => ({
  verifyPurchaseToken: async (_token, productId) => ({ valid: true, planId: productId, orderId: "GPA.1", expiresAt }),
});

/** A Razorpay purchase fulfilled at `paidAt`. */
async function paidThroughRazorpay(store: Store, accountId: string, periodDays: number, paidAt: Date) {
  const orderId = "order_" + crypto.randomUUID();
  await store.createPaymentOrder({ orderId, accountId, planKey: "pro_monthly", amountPaise: 49_900, currency: "INR", periodDays, credits: 0, status: "created", createdAt: paidAt });
  await store.fulfillPaymentOrder(orderId, "pay_" + crypto.randomUUID(), paidAt);
}

describe.each(STORES)("Play Billing purchases set the plan's expiry (%s)", (_label, makeStore) => {
  let store: Store;

  beforeEach(() => {
    store = makeStore();
  });

  it("a Play purchase after a lapsed paid period makes the account PRO again", async () => {
    const app = serverWith(store);
    const me = await newGuest(app);
    await paidThroughRazorpay(store, me.accountId, 30, new Date(Date.now() - 40 * DAY)); // lapsed 10 days ago

    const play = await request(app).post("/api/v1/billing/webhook").set(auth(me)).send({ purchaseToken: "tok-" + crypto.randomUUID(), productId: "zarvis_pro_monthly" });
    expect(play.status).toBe(200);
    expect(play.body.account).toEqual({ id: me.accountId, plan: "PRO" });

    const entitlements = await request(app).get("/api/v1/entitlements/me").set(auth(me));
    expect(entitlements.body.plan).toBe("PRO");
    expect(new Date(entitlements.body.planExpiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("a Play purchase is PRO only until the subscription's own expiry, not forever", async () => {
    const expiresAt = new Date(Date.now() + 30 * DAY);
    const app = serverWith(store, validUntil(expiresAt));
    const me = await newGuest(app);

    const play = await request(app).post("/api/v1/billing/webhook").set(auth(me)).send({ purchaseToken: "tok-" + crypto.randomUUID(), productId: "zarvis_pro_monthly" });
    expect(play.status).toBe(200);
    expect(Object.keys(play.body.verification).sort()).toEqual(["orderId", "planId", "valid"]); // the response body keeps its shape

    const account = await store.getAccount(me.accountId);
    expect(account?.plan).toBe("PRO");
    expect(account?.planExpiresAt?.toISOString()).toBe(expiresAt.toISOString());
  });

  it("a Play purchase does not cut short a paid period that already runs longer", async () => {
    const app = serverWith(store, validUntil(new Date(Date.now() + 30 * DAY)));
    const me = await newGuest(app);
    await paidThroughRazorpay(store, me.accountId, 365, new Date());
    const yearly = (await store.getAccount(me.accountId))!.planExpiresAt!;

    await request(app).post("/api/v1/billing/webhook").set(auth(me)).send({ purchaseToken: "tok-" + crypto.randomUUID(), productId: "zarvis_pro_monthly" }).expect(200);
    expect((await store.getAccount(me.accountId))?.planExpiresAt?.toISOString()).toBe(yearly.toISOString());
  });

  it("claiming a purchase token and granting its plan happen together: a failed grant leaves the token usable", async () => {
    const user = await store.createUser(`play-${crypto.randomUUID()}@test.dev`, "x");
    const account = await store.createAccountForUser(user.id);
    const token = "tok-" + crypto.randomUUID();
    const until = new Date(Date.now() + 30 * DAY);

    await expect(store.grantPlayPurchase(token, crypto.randomUUID(), "zarvis_pro_monthly", "PRO", until)).rejects.toThrow();
    const granted = await store.grantPlayPurchase(token, account.id, "zarvis_pro_monthly", "PRO", until);
    expect(granted).toMatchObject({ id: account.id, plan: "PRO" });
    expect(granted?.planExpiresAt?.toISOString()).toBe(until.toISOString());
    // Used once: a replay (by anyone) changes nothing.
    expect(await store.grantPlayPurchase(token, account.id, "zarvis_pro_monthly", "PRO", new Date(Date.now() + 90 * DAY))).toBeUndefined();
    expect((await store.getAccount(account.id))?.planExpiresAt?.toISOString()).toBe(until.toISOString());
  });
});
