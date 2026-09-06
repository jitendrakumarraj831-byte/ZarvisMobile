import { describe, expect, it } from "vitest";
import { PostgresStore } from "../../src/store/postgresStore.js";

/**
 * Exercises PostgresStore against a real database — set TEST_DATABASE_URL to run these
 * (e.g. a disposable local Postgres or CI service container). Skipped otherwise, since no
 * database is available in the default test environment; InMemoryStore already covers this
 * same Store contract in test/auth/authService.test.ts and test/api/api.test.ts.
 */
describe.skipIf(!process.env.TEST_DATABASE_URL)("PostgresStore", () => {
  const store = new PostgresStore(process.env.TEST_DATABASE_URL ?? "");

  it("persists a user/account/trial across separate calls, like a fresh serverless invocation would see", async () => {
    const email = `test-${Date.now()}@example.com`;
    const user = await store.createUser(email, "hashed");
    const account = await store.createAccountForUser(user.id);

    const reread = new PostgresStore(process.env.TEST_DATABASE_URL ?? "");
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
});
