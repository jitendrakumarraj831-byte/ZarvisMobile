import { describe, expect, it } from "vitest";
import { Pool } from "pg";
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

  it("leaves no transaction open after the race", async () => {
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      // Give released connections a moment to report their state.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'",
      );
      expect(rows[0].n).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it("deleting an account removes its sessions, confirmations, conversations and turn records", async () => {
    const store = new PostgresStore(TEST_DATABASE_URL!);
    const user = await store.createUser(`cleanup-${crypto.randomUUID()}@test.dev`, "x");
    const account = await store.createAccountForUser(user.id);
    const now = new Date();
    await store.createSession({ id: crypto.randomUUID(), userId: user.id, accountId: account.id, refreshTokenHash: "h", createdAt: now, expiresAt: new Date(now.getTime() + 60_000), lastUsedAt: now });
    await store.createConfirmation({
      id: crypto.randomUUID(), accountId: account.id, skillId: "s", input: {}, inputHash: "i", action: "a",
      riskLevel: "HIGH", actionClass: "SECURITY_SENSITIVE", status: "PENDING", createdAt: now, expiresAt: new Date(now.getTime() + 60_000),
    } as Parameters<PostgresStore["createConfirmation"]>[0]);
    await store.createConversation(account.id, "t");
    await store.claimTurn(account.id, "cleanup-turn-1", "f", now, new Date(0));

    await store.deleteAccount(account.id);

    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const counts: Record<string, number> = {};
      for (const table of ["auth_sessions", "confirmations", "conversations", "turn_records", "accounts"]) {
        const column = table === "accounts" ? "id" : "account_id";
        const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [account.id]);
        counts[table] = rows[0].n;
      }
      const users = await pool.query("SELECT count(*)::int AS n FROM users WHERE id = $1", [user.id]);
      counts.users = users.rows[0].n;
      expect(counts).toEqual({ auth_sessions: 0, confirmations: 0, conversations: 0, turn_records: 0, accounts: 0, users: 0 });
    } finally {
      await pool.end();
    }
  });
});
