import { describe, expect, it } from "vitest";
import { PostgresStore } from "../../src/store/postgresStore.js";

/**
 * Schema setup runs on every cold start (a new PostgresStore) while other instances serve
 * requests. It used to deadlock with a concurrent account deletion: the schema script locks
 * `users` and then index tables, deleteAccount locks those tables and then `users`. Postgres
 * aborted one of them (CI: guest sign-up got a 500).
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("PostgresStore schema setup under concurrency", () => {
  it("cold starts and account deletions running at the same time never deadlock", async () => {
    const seed = new PostgresStore(TEST_DATABASE_URL!);
    const accounts = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
      const user = await seed.createUser(`deadlock-${i}-${crypto.randomUUID()}@test.dev`, "x");
      const account = await seed.createAccountForUser(user.id);
      // Rows in the tables deleteAccount clears before it reaches `users`.
      await seed.createConversation(account.id, "t");
      return account.id;
    }));

    const results = await Promise.allSettled([
      ...accounts.map((id) => seed.deleteAccount(id)),
      // Fresh instances = cold starts: each one runs the schema script first.
      ...Array.from({ length: 12 }, () => new PostgresStore(TEST_DATABASE_URL!).createUser(`cold-${crypto.randomUUID()}@test.dev`, "x")),
    ]);

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => String(r.reason));
    expect(failures).toEqual([]);
  }, 60_000);
});
