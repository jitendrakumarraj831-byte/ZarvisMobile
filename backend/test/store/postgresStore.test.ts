import { beforeAll, describe, expect, it } from "vitest";
import { PostgresStore } from "../../src/store/postgresStore.js";

/**
 * Exercises PostgresStore against a real database — set TEST_DATABASE_URL to run these
 * (e.g. a disposable local Postgres or CI service container). Skipped otherwise, since no
 * database is available in the default test environment; InMemoryStore already covers this
 * same Store contract in test/auth/authService.test.ts and test/api/api.test.ts.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("PostgresStore", () => {
  // `describe.skipIf` still runs this factory to discover the `it`s below even when
  // skipped — only the tests themselves are skipped — so constructing a PostgresStore
  // (and, since it parses the connection string as a URL, a real one) must wait for
  // `beforeAll`, which vitest does *not* run for a skipped suite.
  let store: PostgresStore;
  beforeAll(() => {
    store = new PostgresStore(TEST_DATABASE_URL!);
  });

  it("persists a user/account/trial across separate calls, like a fresh serverless invocation would see", async () => {
    const email = `test-${Date.now()}@example.com`;
    const user = await store.createUser(email, "hashed");
    const account = await store.createAccountForUser(user.id);

    const reread = new PostgresStore(TEST_DATABASE_URL!);
    expect(await reread.findUserById(user.id)).toMatchObject({ id: user.id, email });
    expect(await reread.getAccount(account.id)).toMatchObject({ id: account.id, userId: user.id });
    expect(await reread.getCreditBalance(account.id)).toBe(50);
  });

  it("atomically deducts usage from the credit balance", async () => {
    const user = await store.createUser(`usage-${Date.now()}@example.com`, "hashed");
    const account = await store.createAccountForUser(user.id);

    const balance = await store.recordUsage({
      id: crypto.randomUUID(),
      accountId: account.id,
      skillId: "test.skill",
      cost: 5,
      createdAt: new Date(),
    });

    expect(balance).toBe(45);
    expect(await store.getCreditBalance(account.id)).toBe(45);
  });

  it("round-trips task steps through JSONB", async () => {
    const user = await store.createUser(`task-${Date.now()}@example.com`, "hashed");
    const account = await store.createAccountForUser(user.id);

    const created = await store.createTask({
      id: crypto.randomUUID(),
      accountId: account.id,
      goal: "test goal",
      status: "PENDING",
      steps: [{ id: "s1", description: "step one", status: "PENDING", retryCount: 0 }],
      riskLevel: "LOW",
      createdAt: new Date(),
    });

    const fetched = await store.getTask(created.id);
    expect(fetched?.steps).toEqual(created.steps);
  });

  it("deleteAccount cascades to tasks, usage, and the user record", async () => {
    const email = `delete-${Date.now()}@example.com`;
    const user = await store.createUser(email, "hashed");
    const account = await store.createAccountForUser(user.id);
    await store.createTask({
      id: crypto.randomUUID(),
      accountId: account.id,
      goal: "goal",
      status: "PENDING",
      steps: [],
      riskLevel: "LOW",
      createdAt: new Date(),
    });

    await store.deleteAccount(account.id);

    expect(await store.getAccount(account.id)).toBeUndefined();
    expect(await store.findUserById(user.id)).toBeUndefined();
    expect(await store.listTasksForAccount(account.id)).toEqual([]);
  });

  it("rotates a session refresh hash atomically: exactly one of two concurrent rotations wins", async () => {
    const user = await store.createUser(`session-${Date.now()}@example.com`, "hashed");
    const account = await store.createAccountForUser(user.id);
    const now = new Date();
    const later = new Date(now.getTime() + 60_000);
    const session = await store.createSession({
      id: crypto.randomUUID(), userId: user.id, accountId: account.id, refreshTokenHash: "h0",
      createdAt: now, expiresAt: later, lastUsedAt: now,
    });
    const results = await Promise.all([
      store.rotateSession(session.id, "h0", "h1", later, now),
      store.rotateSession(session.id, "h0", "h2", later, now),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await store.revokeSession(session.id, now);
    expect((await store.getSession(session.id))?.revokedAt).toBeInstanceOf(Date);
    const current = (await store.getSession(session.id))!.refreshTokenHash;
    expect(await store.rotateSession(session.id, current, "h3", later, now)).toBe(false);
  });

  it("resolves a confirmation exactly once, only for its owner, only before expiry", async () => {
    const user = await store.createUser(`confirm-${Date.now()}@example.com`, "hashed");
    const account = await store.createAccountForUser(user.id);
    const now = new Date();
    const base = {
      accountId: account.id, skillId: "developer.implement", input: { repoUrl: "https://github.com/a/b" }, inputHash: "abc",
      action: "do it", riskLevel: "HIGH" as const, actionClass: "EXTERNAL_COMMUNICATION" as const, status: "PENDING" as const, createdAt: now,
    };
    const live = await store.createConfirmation({ ...base, id: crypto.randomUUID(), expiresAt: new Date(now.getTime() + 60_000) });
    const expired = await store.createConfirmation({ ...base, id: crypto.randomUUID(), expiresAt: new Date(now.getTime() - 1) });

    expect(await store.resolveConfirmation(crypto.randomUUID(), live.id, "APPROVED", now)).toBeUndefined();
    const results = await Promise.all([
      store.resolveConfirmation(account.id, live.id, "APPROVED", now),
      store.resolveConfirmation(account.id, live.id, "APPROVED", now),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.find(Boolean)!.input).toEqual({ repoUrl: "https://github.com/a/b" });
    expect(await store.resolveConfirmation(account.id, expired.id, "APPROVED", now)).toBeUndefined();
  });

  it("links a guest user's credentials and cascades new tables on account deletion", async () => {
    const user = await store.createUser(`guest-${crypto.randomUUID()}@device.zarvismobile.local`, "hashed", true);
    const account = await store.createAccountForUser(user.id);
    expect((await store.findUserById(user.id))?.isGuest).toBe(true);
    const linked = await store.updateUserCredentials(user.id, `linked-${Date.now()}@example.com`, "hashed2");
    expect(linked.isGuest).toBe(false);

    const now = new Date();
    await store.createSession({ id: crypto.randomUUID(), userId: user.id, accountId: account.id, refreshTokenHash: "h", createdAt: now, expiresAt: now, lastUsedAt: now });
    await store.saveGitHubConnection({ accountId: account.id, encryptedToken: "v1:x", githubLogin: "a", scopes: "", connectedAt: now });
    await store.deleteAccount(account.id);
    expect(await store.getGitHubConnection(account.id)).toBeUndefined();
    expect(await store.findUserById(user.id)).toBeUndefined();
  });

  describe("payment orders", () => {
    async function accountWithOrder(orderId: string, periodDays = 30, credits = 1000) {
      const user = await store.createUser(`pay-${orderId}-${Date.now()}@example.com`, "hashed");
      const account = await store.createAccountForUser(user.id);
      await store.createPaymentOrder({ orderId, accountId: account.id, planKey: "pro_monthly", amountPaise: 49900, currency: "INR", periodDays, credits, status: "created", createdAt: new Date() });
      return account;
    }

    it("round-trips an order and grants Pro + credits atomically, exactly once", async () => {
      const orderId = `order_${Date.now()}_a`;
      const account = await accountWithOrder(orderId);
      expect(await store.getPaymentOrder(orderId)).toMatchObject({ orderId, accountId: account.id, amountPaise: 49900, status: "created" });

      const now = new Date("2026-10-05T10:00:00Z");
      const first = await store.fulfillPaymentOrder(orderId, "pay_1", now);
      expect(first).toMatchObject({ status: "fulfilled", creditBalance: 1050 });
      const reread = await store.getAccount(account.id);
      expect(reread).toMatchObject({ plan: "PRO" });
      expect(reread!.planExpiresAt!.getTime()).toBe(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      expect(await store.getPaymentOrder(orderId)).toMatchObject({ status: "paid", paymentId: "pay_1" });
      expect(await store.fulfillPaymentOrder(orderId, "pay_1", now)).toEqual({ status: "already_fulfilled" });
      expect(await store.getCreditBalance(account.id)).toBe(1050);
      expect(await store.fulfillPaymentOrder("order_unknown", "pay_x", now)).toEqual({ status: "not_found" });
    });

    it("concurrent fulfilments (client verify + webhook) grant the credits only once", async () => {
      const orderId = `order_${Date.now()}_b`;
      const account = await accountWithOrder(orderId);
      const results = await Promise.all([1, 2, 3, 4].map(() => store.fulfillPaymentOrder(orderId, "pay_race", new Date())));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await store.getCreditBalance(account.id)).toBe(1050);
    });

    it("stacks a renewal onto a running period and removes orders with the account", async () => {
      const first = `order_${Date.now()}_c`;
      const account = await accountWithOrder(first);
      const now = new Date();
      await store.fulfillPaymentOrder(first, "pay_c1", now);
      const second = `order_${Date.now()}_d`;
      await store.createPaymentOrder({ orderId: second, accountId: account.id, planKey: "pro_yearly", amountPaise: 499900, currency: "INR", periodDays: 365, credits: 12000, status: "created", createdAt: now });
      const result = await store.fulfillPaymentOrder(second, "pay_c2", now);
      expect(result.status).toBe("fulfilled");
      const expiry = (await store.getAccount(account.id))!.planExpiresAt!;
      expect(Math.round((expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))).toBe(395);

      await store.deleteAccount(account.id);
      expect(await store.getPaymentOrder(first)).toBeUndefined();
      expect(await store.getPaymentOrder(second)).toBeUndefined();
    });
  });
});
