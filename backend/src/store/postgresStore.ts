import { randomUUID } from "node:crypto";
import { Pool, type QueryResultRow } from "pg";
import type { PermissionType, Task } from "../domain/types.js";
import {
  EmailTakenError,
  InsufficientCreditsError,
  extendPlanExpiry, type Account, type AuthSession, type ConfirmationRecord, type ConfirmationStatus, type Conversation,
  type ConversationMessage, type FulfillmentResult, type GitHubConnection, type PaymentOrder, type Store, type StoreHealth, type TrialRecord, type TurnClaim,
  type TurnRecord, type TurnRecordStatus, type UsageEntry, type User, TURN_RECORD_RETENTION_MS
} from "./store.js";

const TRIAL_DURATION_DAYS = 14;

/**
 * Ids that reach the store from a client (a conversation, confirmation or task id in a URL or
 * body) are looked up in UUID columns. Postgres rejects a non-UUID value with an error (22P02),
 * which surfaced as a 500 on every request carrying it, e.g. a stale conversation id stored by
 * a browser made every turn fail. A value that is not a UUID cannot name a row: not found, the
 * same answer InMemoryStore gives.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string): boolean => UUID_PATTERN.test(value);
const TRIAL_INCLUDED_CREDITS = 50;

/**
 * Advisory lock key that orders schema setup against multi-table writes. The schema script is
 * one multi-statement query, i.e. one implicit transaction: it locks `users` (ALTER/UPDATE) and
 * then the indexed tables (CREATE INDEX takes a ShareLock even when the index exists).
 * deleteAccount locks those tables first and `users` last. Run concurrently (a serverless cold
 * start during an account deletion) they deadlocked and Postgres aborted one. Schema setup
 * takes this lock exclusively, deleteAccount shared, both before any table lock, so they never
 * interleave. Arbitrary constant: "ZARV" in ASCII.
 */
const SCHEMA_LOCK_KEY = 0x5a415256;

const SCHEMA = `
  SELECT pg_advisory_xact_lock(${SCHEMA_LOCK_KEY});
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES users(id),
    plan TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trials (
    account_id UUID PRIMARY KEY REFERENCES accounts(id),
    starts_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    included_credits INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS credit_balances (
    account_id UUID PRIMARY KEY REFERENCES accounts(id),
    balance NUMERIC NOT NULL
  );
  CREATE TABLE IF NOT EXISTS usage_ledger (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id),
    skill_id TEXT NOT NULL,
    cost NUMERIC NOT NULL,
    task_id UUID,
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS account_permissions (
    account_id UUID NOT NULL REFERENCES accounts(id),
    permission TEXT NOT NULL,
    PRIMARY KEY (account_id, permission)
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL,
    goal TEXT NOT NULL,
    status TEXT NOT NULL,
    steps JSONB NOT NULL,
    risk_level TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    title TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conversation_messages (
    id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS consumed_purchase_tokens (
    purchase_token TEXT PRIMARY KEY,
    account_id UUID NOT NULL,
    product_id TEXT NOT NULL,
    consumed_at TIMESTAMPTZ NOT NULL
  );
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;
  CREATE TABLE IF NOT EXISTS payment_orders (
    order_id TEXT PRIMARY KEY,
    account_id UUID NOT NULL,
    plan_key TEXT NOT NULL,
    amount_paise BIGINT NOT NULL,
    currency TEXT NOT NULL,
    period_days INTEGER NOT NULL,
    credits INTEGER NOT NULL,
    status TEXT NOT NULL,
    payment_id TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS payment_orders_account_idx ON payment_orders (account_id, created_at DESC);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE;
  UPDATE users SET is_guest = TRUE
    WHERE is_guest = FALSE
      AND (email LIKE 'guest-%@device.zarvismobile.local' OR email LIKE 'guest-%@device.zarvismobile.com');
  CREATE TABLE IF NOT EXISTS auth_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS confirmations (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    skill_id TEXT NOT NULL,
    input JSONB NOT NULL,
    input_hash TEXT NOT NULL,
    action TEXT NOT NULL,
    risk_level TEXT NOT NULL,
    action_class TEXT NOT NULL,
    conversation_id UUID,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS github_connections (
    account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    encrypted_token TEXT NOT NULL,
    github_login TEXT NOT NULL,
    scopes TEXT NOT NULL,
    connected_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS turn_records (
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    client_turn_id TEXT NOT NULL,
    status TEXT NOT NULL,
    conversation_id UUID,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (account_id, client_turn_id)
  );
  ALTER TABLE turn_records ADD COLUMN IF NOT EXISTS fingerprint TEXT;
  CREATE INDEX IF NOT EXISTS auth_sessions_account_idx ON auth_sessions (account_id);
  CREATE INDEX IF NOT EXISTS confirmations_account_idx ON confirmations (account_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS conversation_messages_conversation_created_idx
    ON conversation_messages (conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS conversations_account_updated_idx
    ON conversations (account_id, updated_at DESC);
`;

/**
 * Postgres-backed [Store] — see store.ts. Needed because InMemoryStore's state does not
 * survive a serverless cold start (each Vercel invocation can get a fresh process), which
 * otherwise breaks refresh tokens and everything behind requireAuth soon after signup/login.
 * Selected automatically by container.ts when DATABASE_URL/POSTGRES_URL is set.
 */
export class PostgresStore implements Store {
  private readonly pool: Pool;
  private schemaReady: Promise<void> | undefined;

  constructor(connectionString: string) {
    // Serverless functions run many concurrent short-lived invocations against one Postgres
    // instance, so each keeps at most a couple of connections open (use a pooled/pgbouncer
    // connection string from your provider, e.g. Vercel Postgres/Neon's "Pooled connection").
    const { connectionString: sanitized, ssl } = poolConfigFor(connectionString);
    this.pool = new Pool({ connectionString: sanitized, max: 5, ssl });
  }

  /**
   * Opens a connection, ensures the schema and runs one query, within 5 s. The result is a
   * fixed code (never the error text, which can contain connection details); the full error is
   * logged server-side with the action that fixes it.
   */
  async healthCheck(): Promise<StoreHealth> {
    try {
      await Promise.race([
        this.ensureSchema().then(() => this.pool.query("SELECT 1")),
        new Promise((_, reject) => setTimeout(() => reject(new Error("health check timed out")), 5000)),
      ]);
      return "ok";
    } catch (err) {
      const status = classifyDatabaseError(err);
      console.error(
        JSON.stringify({
          level: "error",
          message: "Database health check failed",
          status,
          hint:
            status === "tls_certificate_untrusted"
              ? "The database's TLS certificate is not publicly trusted. Set POSTGRES_CA_CERT to the provider's CA certificate (preferred), or POSTGRES_SSL_MODE=no-verify, in every Vercel environment that uses this database (Production and Preview)."
              : status === "auth_failed"
                ? "Check the user and password in POSTGRES_URL for this environment."
                : status === "unreachable"
                  ? "Check the host/port in POSTGRES_URL and that the database accepts connections from Vercel."
                  : undefined,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        }),
      );
      return status;
    }
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      // On failure, clear the cached promise so the *next* call retries schema creation from
      // scratch instead of forever re-awaiting this same rejected promise. Without this, one
      // transient failure (a cold-start connection blip, the database briefly unreachable) on
      // this warm serverless instance's very first query would permanently poison every
      // request it ever serves afterward — e.g. every guest signup failing with a 500 for as
      // long as Vercel keeps reusing this instance, even once the underlying issue clears.
      this.schemaReady = this.pool.query(SCHEMA).then(
        () => undefined,
        (err) => {
          this.schemaReady = undefined;
          throw err;
        },
      );
    }
    return this.schemaReady;
  }

  private async query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
    await this.ensureSchema();
    return this.pool.query<T>(text, params);
  }

  async createUser(email: string, passwordHash: string, isGuest = false): Promise<User> {
    const id = randomUUID();
    const createdAt = new Date();
    try {
      await this.query(
        "INSERT INTO users (id, email, password_hash, is_guest, created_at) VALUES ($1, $2, $3, $4, $5)",
        [id, email, passwordHash, isGuest, createdAt],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new EmailTakenError();
      }
      throw err;
    }
    return { id, email, passwordHash, isGuest, createdAt };
  }

  async updateUserCredentials(userId: string, email: string, passwordHash: string): Promise<User> {
    try {
      const { rows } = await this.query<UserRow>(
        "UPDATE users SET email = $2, password_hash = $3, is_guest = FALSE WHERE id = $1 RETURNING *",
        [userId, email, passwordHash],
      );
      if (!rows[0]) throw new Error(`Cannot update unknown user '${userId}'`);
      return toUser(rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) throw new EmailTakenError();
      throw err;
    }
  }

  async createSession(session: AuthSession): Promise<AuthSession> {
    await this.query(
      `INSERT INTO auth_sessions (id, user_id, account_id, refresh_token_hash, created_at, expires_at, last_used_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [session.id, session.userId, session.accountId, session.refreshTokenHash, session.createdAt, session.expiresAt,
        session.lastUsedAt, session.revokedAt ?? null],
    );
    return session;
  }

  async getSession(sessionId: string): Promise<AuthSession | undefined> {
    if (!isUuid(sessionId)) return undefined;
    const { rows } = await this.query<SessionRow>("SELECT * FROM auth_sessions WHERE id = $1", [sessionId]);
    return rows[0] ? toSession(rows[0]) : undefined;
  }

  async rotateSession(sessionId: string, expectedHash: string, newHash: string, newExpiresAt: Date, now: Date): Promise<boolean> {
    if (!isUuid(sessionId)) return false;
    const { rowCount } = await this.query(
      `UPDATE auth_sessions SET refresh_token_hash = $3, expires_at = $4, last_used_at = $5
       WHERE id = $1 AND refresh_token_hash = $2 AND revoked_at IS NULL AND expires_at > $5`,
      [sessionId, expectedHash, newHash, newExpiresAt, now],
    );
    return rowCount === 1;
  }

  async revokeSession(sessionId: string, now: Date): Promise<void> {
    if (!isUuid(sessionId)) return;
    await this.query("UPDATE auth_sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL", [sessionId, now]);
  }

  async createConfirmation(record: ConfirmationRecord): Promise<ConfirmationRecord> {
    await this.query(
      `INSERT INTO confirmations (id, account_id, skill_id, input, input_hash, action, risk_level, action_class,
         conversation_id, status, created_at, expires_at, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [record.id, record.accountId, record.skillId, JSON.stringify(record.input), record.inputHash, record.action,
        record.riskLevel, record.actionClass, record.conversationId ?? null, record.status, record.createdAt,
        record.expiresAt, record.resolvedAt ?? null],
    );
    return record;
  }

  async getConfirmation(accountId: string, confirmationId: string): Promise<ConfirmationRecord | undefined> {
    if (!isUuid(confirmationId)) return undefined;
    const { rows } = await this.query<ConfirmationRow>(
      "SELECT * FROM confirmations WHERE id = $1 AND account_id = $2",
      [confirmationId, accountId],
    );
    return rows[0] ? toConfirmation(rows[0]) : undefined;
  }

  async resolveConfirmation(
    accountId: string,
    confirmationId: string,
    status: Exclude<ConfirmationStatus, "PENDING">,
    now: Date,
  ): Promise<ConfirmationRecord | undefined> {
    if (!isUuid(confirmationId)) return undefined;
    const { rows } = await this.query<ConfirmationRow>(
      `UPDATE confirmations SET status = $3, resolved_at = $4
       WHERE id = $1 AND account_id = $2 AND status = 'PENDING' AND expires_at > $4
       RETURNING *`,
      [confirmationId, accountId, status, now],
    );
    return rows[0] ? toConfirmation(rows[0]) : undefined;
  }

  async saveGitHubConnection(connection: GitHubConnection): Promise<void> {
    await this.query(
      `INSERT INTO github_connections (account_id, encrypted_token, github_login, scopes, connected_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id) DO UPDATE SET encrypted_token = EXCLUDED.encrypted_token,
         github_login = EXCLUDED.github_login, scopes = EXCLUDED.scopes, connected_at = EXCLUDED.connected_at`,
      [connection.accountId, connection.encryptedToken, connection.githubLogin, connection.scopes, connection.connectedAt],
    );
  }

  async getGitHubConnection(accountId: string): Promise<GitHubConnection | undefined> {
    const { rows } = await this.query<GitHubConnectionRow>("SELECT * FROM github_connections WHERE account_id = $1", [accountId]);
    const row = rows[0];
    if (!row) return undefined;
    return {
      accountId: row.account_id,
      encryptedToken: row.encrypted_token,
      githubLogin: row.github_login,
      scopes: row.scopes,
      connectedAt: row.connected_at,
    };
  }

  async deleteGitHubConnection(accountId: string): Promise<void> {
    await this.query("DELETE FROM github_connections WHERE account_id = $1", [accountId]);
  }

  async findUserByEmail(email: string): Promise<User | undefined> {
    const { rows } = await this.query<UserRow>("SELECT * FROM users WHERE email = $1", [email]);
    return rows[0] ? toUser(rows[0]) : undefined;
  }

  async findUserById(id: string): Promise<User | undefined> {
    const { rows } = await this.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] ? toUser(rows[0]) : undefined;
  }

  async createAccountForUser(userId: string): Promise<Account> {
    const id = randomUUID();
    const createdAt = new Date();
    const plan = "TRIAL";
    await this.query(
      "INSERT INTO accounts (id, user_id, plan, created_at) VALUES ($1, $2, $3, $4)",
      [id, userId, plan, createdAt],
    );

    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
    await this.query(
      "INSERT INTO trials (account_id, starts_at, expires_at, included_credits) VALUES ($1, $2, $3, $4)",
      [id, startsAt, expiresAt, TRIAL_INCLUDED_CREDITS],
    );
    await this.query("INSERT INTO credit_balances (account_id, balance) VALUES ($1, $2)", [
      id,
      TRIAL_INCLUDED_CREDITS,
    ]);

    return { id, userId, plan, createdAt };
  }

  async getAccount(accountId: string): Promise<Account | undefined> {
    const { rows } = await this.query<AccountRow>("SELECT * FROM accounts WHERE id = $1", [accountId]);
    return rows[0] ? toAccount(rows[0]) : undefined;
  }

  async getAccountByUserId(userId: string): Promise<Account | undefined> {
    const { rows } = await this.query<AccountRow>("SELECT * FROM accounts WHERE user_id = $1", [userId]);
    return rows[0] ? toAccount(rows[0]) : undefined;
  }

  async updateAccountPlan(accountId: string, plan: Account["plan"]): Promise<Account> {
    const { rows } = await this.query<AccountRow>(
      "UPDATE accounts SET plan = $2 WHERE id = $1 RETURNING *",
      [accountId, plan],
    );
    if (!rows[0]) {
      throw new Error(`Cannot update unknown account '${accountId}'`);
    }
    return toAccount(rows[0]);
  }

  async deleteAccount(accountId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.ensureSchema();
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock_shared($1)", [SCHEMA_LOCK_KEY]);
      const { rows } = await client.query<AccountRow>("SELECT * FROM accounts WHERE id = $1 FOR UPDATE", [
        accountId,
      ]);
      const account = rows[0];
      if (!account) {
        throw new Error(`Cannot delete unknown account '${accountId}'`);
      }
      await client.query("DELETE FROM usage_ledger WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM payment_orders WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM auth_sessions WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM confirmations WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM github_connections WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM account_permissions WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM trials WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM credit_balances WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM tasks WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM turn_records WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM conversations WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM accounts WHERE id = $1", [accountId]);
      await client.query("DELETE FROM users WHERE id = $1", [account.user_id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getTrial(accountId: string): Promise<TrialRecord | undefined> {
    const { rows } = await this.query<TrialRow>("SELECT * FROM trials WHERE account_id = $1", [accountId]);
    const row = rows[0];
    if (!row) return undefined;
    return {
      accountId: row.account_id,
      startsAt: row.starts_at,
      expiresAt: row.expires_at,
      includedCredits: row.included_credits,
    };
  }

  async getCreditBalance(accountId: string): Promise<number> {
    const { rows } = await this.query<{ balance: string }>(
      "SELECT balance FROM credit_balances WHERE account_id = $1",
      [accountId],
    );
    return rows[0] ? Number(rows[0].balance) : 0;
  }

  async recordUsage(entry: UsageEntry): Promise<number> {
    const { rows } = await this.query<{ balance: string }>(
      `WITH updated AS (
         UPDATE credit_balances
         SET balance = balance - $4
         WHERE account_id = $2 AND balance >= $4
         RETURNING balance
       ), inserted AS (
         INSERT INTO usage_ledger (id, account_id, skill_id, cost, task_id, created_at)
         SELECT $1, $2, $3, $4, $5, $6
         WHERE EXISTS (SELECT 1 FROM updated)
       )
       SELECT balance FROM updated`,
      [entry.id, entry.accountId, entry.skillId, entry.cost, entry.taskId ?? null, entry.createdAt],
    );
    if (!rows[0]) throw new InsufficientCreditsError(entry.accountId);
    return Number(rows[0].balance);
  }

  async createPaymentOrder(order: PaymentOrder): Promise<void> {
    await this.query(
      `INSERT INTO payment_orders
         (order_id, account_id, plan_key, amount_paise, currency, period_days, credits, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'created', $8)`,
      [order.orderId, order.accountId, order.planKey, order.amountPaise, order.currency, order.periodDays, order.credits, order.createdAt],
    );
  }

  async getPaymentOrder(orderId: string): Promise<PaymentOrder | undefined> {
    const { rows } = await this.query<PaymentOrderRow>("SELECT * FROM payment_orders WHERE order_id = $1", [orderId]);
    return rows[0] ? toPaymentOrder(rows[0]) : undefined;
  }

  async fulfillPaymentOrder(orderId: string, paymentId: string, now: Date): Promise<FulfillmentResult> {
    const client = await this.pool.connect();
    try {
      await this.ensureSchema();
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock_shared($1)", [SCHEMA_LOCK_KEY]);
      // The row lock serialises the client verify and the webhook: whoever locks first fulfils,
      // the other sees status = 'paid' and changes nothing.
      const orderRes = await client.query<PaymentOrderRow>("SELECT * FROM payment_orders WHERE order_id = $1 FOR UPDATE", [orderId]);
      const order = orderRes.rows[0];
      if (!order) {
        await client.query("ROLLBACK");
        return { status: "not_found" };
      }
      if (order.status === "paid") {
        await client.query("ROLLBACK");
        return { status: "already_fulfilled" };
      }
      const accountRes = await client.query<AccountRow>("SELECT * FROM accounts WHERE id = $1 FOR UPDATE", [order.account_id]);
      const account = accountRes.rows[0];
      if (!account) {
        await client.query("ROLLBACK");
        return { status: "not_found" };
      }
      const expiresAt = extendPlanExpiry(toAccount(account), order.period_days, now);
      const updated = await client.query<AccountRow>(
        "UPDATE accounts SET plan = 'PRO', plan_expires_at = $2 WHERE id = $1 RETURNING *",
        [account.id, expiresAt],
      );
      const balance = await client.query<{ balance: string }>(
        `INSERT INTO credit_balances (account_id, balance) VALUES ($1, $2)
         ON CONFLICT (account_id) DO UPDATE SET balance = credit_balances.balance + EXCLUDED.balance
         RETURNING balance`,
        [account.id, order.credits],
      );
      await client.query(
        "UPDATE payment_orders SET status = 'paid', payment_id = $2, paid_at = $3 WHERE order_id = $1",
        [orderId, paymentId, now],
      );
      await client.query("COMMIT");
      return { status: "fulfilled", account: toAccount(updated.rows[0]!), creditBalance: Number(balance.rows[0]!.balance) };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async claimPurchaseToken(purchaseToken: string, accountId: string, productId: string): Promise<boolean> {
    const { rows } = await this.query<{ purchase_token: string }>(
      `INSERT INTO consumed_purchase_tokens (purchase_token, account_id, product_id, consumed_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (purchase_token) DO NOTHING
       RETURNING purchase_token`,
      [purchaseToken, accountId, productId, new Date()],
    );
    return rows.length > 0;
  }

  async listUsage(accountId: string): Promise<UsageEntry[]> {
    const { rows } = await this.query<UsageRow>(
      "SELECT * FROM usage_ledger WHERE account_id = $1 ORDER BY created_at ASC",
      [accountId],
    );
    return rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      skillId: row.skill_id,
      cost: Number(row.cost),
      taskId: row.task_id ?? undefined,
      createdAt: row.created_at,
    }));
  }

  async claimTurn(accountId: string, clientTurnId: string, fingerprint: string, now: Date, staleBefore: Date): Promise<TurnClaim> {
    await this.query("DELETE FROM turn_records WHERE account_id = $1 AND updated_at < $2", [
      accountId,
      new Date(now.getTime() - TURN_RECORD_RETENTION_MS),
    ]);
    // The primary key makes exactly one of several concurrent first attempts win.
    const inserted = await this.query(
      `INSERT INTO turn_records (account_id, client_turn_id, fingerprint, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'running', $4, $4) ON CONFLICT DO NOTHING RETURNING account_id`,
      [accountId, clientTurnId, fingerprint, now],
    );
    if (inserted.rows.length > 0) return { kind: "claimed" };
    // A failed or abandoned attempt may run again; the row lock lets only one retry win.
    const previous = await this.query<TurnRecordRow>(
      "SELECT * FROM turn_records WHERE account_id = $1 AND client_turn_id = $2",
      [accountId, clientTurnId],
    );
    const stored = previous.rows[0]?.fingerprint;
    if (stored && stored !== fingerprint) return { kind: "conflict" };
    const reclaimed = await this.query(
      `UPDATE turn_records SET status = 'running', updated_at = $3
       WHERE account_id = $1 AND client_turn_id = $2
         AND (status = 'failed' OR (status = 'running' AND updated_at < $4))
       RETURNING account_id`,
      [accountId, clientTurnId, now, staleBefore],
    );
    if (reclaimed.rows.length > 0) return { kind: "claimed", previous: previous.rows[0] ? toTurnRecord(previous.rows[0]) : undefined };
    const { rows } = await this.query<TurnRecordRow>(
      "SELECT * FROM turn_records WHERE account_id = $1 AND client_turn_id = $2",
      [accountId, clientTurnId],
    );
    return rows[0]?.status === "completed" ? { kind: "completed", record: toTurnRecord(rows[0]) } : { kind: "in_progress" };
  }

  async updateTurn(
    accountId: string,
    clientTurnId: string,
    patch: { status?: TurnRecordStatus; conversationId?: string; result?: unknown },
    now: Date,
  ): Promise<void> {
    await this.query(
      `UPDATE turn_records SET
         status = COALESCE($3, status),
         conversation_id = COALESCE($4, conversation_id),
         result = COALESCE($5::jsonb, result),
         updated_at = $6
       WHERE account_id = $1 AND client_turn_id = $2`,
      [
        accountId,
        clientTurnId,
        patch.status ?? null,
        patch.conversationId ?? null,
        patch.result === undefined ? null : JSON.stringify(patch.result),
        now,
      ],
    );
  }

  async createConversation(accountId: string, title?: string): Promise<Conversation> {
    const id = randomUUID();
    const now = new Date();
    const { rows } = await this.query<ConversationRow>(
      "INSERT INTO conversations (id, account_id, title, created_at, updated_at) VALUES ($1, $2, $3, $4, $4) RETURNING *",
      [id, accountId, title?.trim().slice(0, 120) || null, now],
    );
    return toConversation(rows[0]!);
  }

  async getConversation(accountId: string, conversationId: string): Promise<Conversation | undefined> {
    if (!isUuid(conversationId)) return undefined;
    const { rows } = await this.query<ConversationRow>(
      "SELECT * FROM conversations WHERE id = $1 AND account_id = $2",
      [conversationId, accountId],
    );
    return rows[0] ? toConversation(rows[0]) : undefined;
  }

  async listConversations(accountId: string): Promise<Conversation[]> {
    const { rows } = await this.query<ConversationRow>(
      "SELECT * FROM conversations WHERE account_id = $1 ORDER BY updated_at DESC",
      [accountId],
    );
    return rows.map(toConversation);
  }

  async appendConversationMessages(messages: ConversationMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const client = await this.pool.connect();
    try {
      await this.ensureSchema();
      await client.query("BEGIN");
      for (const message of messages) {
        await client.query(
          "INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5)",
          [message.id, message.conversationId, message.role, message.content, message.createdAt],
        );
      }
      const latest = messages.reduce((max, message) => message.createdAt > max ? message.createdAt : max, messages[0]!.createdAt);
      await client.query("UPDATE conversations SET updated_at = $2 WHERE id = $1", [messages[0]!.conversationId, latest]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listConversationMessages(accountId: string, conversationId: string, limit = 40): Promise<ConversationMessage[]> {
    const conversation = await this.getConversation(accountId, conversationId);
    if (!conversation) return [];
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const { rows } = await this.query<ConversationMessageRow>(
      "SELECT * FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2",
      [conversationId, safeLimit],
    );
    return rows.reverse().map(toConversationMessage);
  }

  async grantedPermissions(accountId: string): Promise<Set<PermissionType>> {
    const { rows } = await this.query<{ permission: PermissionType }>(
      "SELECT permission FROM account_permissions WHERE account_id = $1",
      [accountId],
    );
    return new Set(rows.map((row) => row.permission));
  }

  async grantPermission(accountId: string, permission: PermissionType): Promise<void> {
    await this.query(
      "INSERT INTO account_permissions (account_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [accountId, permission],
    );
  }

  async createTask(task: Task): Promise<Task> {
    await this.query(
      "INSERT INTO tasks (id, account_id, goal, status, steps, risk_level, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [task.id, task.accountId, task.goal, task.status, JSON.stringify(task.steps), task.riskLevel, task.createdAt],
    );
    return task;
  }

  async getTask(taskId: string): Promise<Task | undefined> {
    if (!isUuid(taskId)) return undefined;
    const { rows } = await this.query<TaskRow>("SELECT * FROM tasks WHERE id = $1", [taskId]);
    return rows[0] ? toTask(rows[0]) : undefined;
  }

  async updateTask(task: Task): Promise<Task> {
    const { rowCount } = await this.query(
      "UPDATE tasks SET goal = $2, status = $3, steps = $4, risk_level = $5 WHERE id = $1",
      [task.id, task.goal, task.status, JSON.stringify(task.steps), task.riskLevel],
    );
    if (!rowCount) {
      throw new Error(`Cannot update unknown task '${task.id}'`);
    }
    return task;
  }

  async listTasksForAccount(accountId: string): Promise<Task[]> {
    const { rows } = await this.query<TaskRow>(
      "SELECT * FROM tasks WHERE account_id = $1 ORDER BY created_at ASC",
      [accountId],
    );
    return rows.map(toTask);
  }
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  is_guest: boolean;
  created_at: Date;
}

interface SessionRow {
  id: string;
  user_id: string;
  account_id: string;
  refresh_token_hash: string;
  created_at: Date;
  expires_at: Date;
  last_used_at: Date;
  revoked_at: Date | null;
}

interface ConfirmationRow {
  id: string;
  account_id: string;
  skill_id: string;
  input: Record<string, unknown>;
  input_hash: string;
  action: string;
  risk_level: ConfirmationRecord["riskLevel"];
  action_class: ConfirmationRecord["actionClass"];
  conversation_id: string | null;
  status: ConfirmationStatus;
  created_at: Date;
  expires_at: Date;
  resolved_at: Date | null;
}

interface GitHubConnectionRow {
  account_id: string;
  encrypted_token: string;
  github_login: string;
  scopes: string;
  connected_at: Date;
}

function toSession(row: SessionRow): AuthSession {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    refreshTokenHash: row.refresh_token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at ?? undefined,
  };
}

function toConfirmation(row: ConfirmationRow): ConfirmationRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    skillId: row.skill_id,
    input: row.input,
    inputHash: row.input_hash,
    action: row.action,
    riskLevel: row.risk_level,
    actionClass: row.action_class,
    conversationId: row.conversation_id ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

interface PaymentOrderRow {
  order_id: string;
  account_id: string;
  plan_key: string;
  amount_paise: string | number;
  currency: string;
  period_days: number;
  credits: number;
  status: "created" | "paid";
  payment_id: string | null;
  created_at: Date;
  paid_at: Date | null;
}

function toPaymentOrder(row: PaymentOrderRow): PaymentOrder {
  return {
    orderId: row.order_id,
    accountId: row.account_id,
    planKey: row.plan_key,
    amountPaise: Number(row.amount_paise),
    currency: "INR",
    periodDays: row.period_days,
    credits: row.credits,
    status: row.status,
    paymentId: row.payment_id ?? undefined,
    createdAt: row.created_at,
    paidAt: row.paid_at ?? undefined,
  };
}

interface AccountRow {
  id: string;
  user_id: string;
  plan: Account["plan"];
  plan_expires_at?: Date | null;
  created_at: Date;
}

interface TrialRow {
  account_id: string;
  starts_at: Date;
  expires_at: Date;
  included_credits: number;
}

interface UsageRow {
  id: string;
  account_id: string;
  skill_id: string;
  cost: string;
  task_id: string | null;
  created_at: Date;
}

interface TaskRow {
  id: string;
  account_id: string;
  goal: string;
  status: Task["status"];
  steps: Task["steps"];
  risk_level: Task["riskLevel"];
  created_at: Date;
}

interface ConversationRow {
  id: string;
  account_id: string;
  title: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ConversationMessageRow {
  id: string;
  conversation_id: string;
  role: ConversationMessage["role"];
  content: string;
  created_at: Date;
}

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, passwordHash: row.password_hash, isGuest: row.is_guest, createdAt: row.created_at };
}

function toAccount(row: AccountRow): Account {
  return { id: row.id, userId: row.user_id, plan: row.plan, planExpiresAt: row.plan_expires_at ?? null, createdAt: row.created_at };
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    accountId: row.account_id,
    title: row.title ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toConversationMessage(row: ConversationMessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    accountId: row.account_id,
    goal: row.goal,
    status: row.status,
    steps: row.steps,
    riskLevel: row.risk_level,
    createdAt: row.created_at,
  };
}

/** Maps a pg/Node connection error to a secret-free StoreHealth code. */
export function classifyDatabaseError(err: unknown): StoreHealth {
  const message = err instanceof Error ? err.message : String(err);
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
  if (/self[- ]signed certificate|unable to verify the first certificate|unable to get local issuer certificate|certificate has expired|Hostname\/IP does not match|CERT_/i.test(message + " " + code)) {
    return "tls_certificate_untrusted";
  }
  if (code === "28P01" || code === "28000" || /password authentication failed|no pg_hba\.conf entry/i.test(message)) return "auth_failed";
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|timed out|timeout/i.test(message + " " + code)) return "unreachable";
  if (code.startsWith("42")) return "schema_error";
  return "error";
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "23505";
}

/**
 * TLS for hosted Postgres. Certificate verification is ON by default (a MITM on the database
 * connection would otherwise see every credential hash, token hash and conversation). Hosted
 * providers that present publicly-trusted certificates (Neon, Vercel Postgres, most managed
 * services) work with this default. For a provider with a private CA, set POSTGRES_CA_CERT to
 * its PEM. `POSTGRES_SSL_MODE=no-verify` is an explicit, logged opt-out for providers where
 * neither is possible; it is never silently applied.
 *
 * `sslmode` is stripped from the connection string because pg-connection-string's own parsing
 * of it overrides the explicit `ssl` object passed alongside (verified against a real
 * pg.Client), so our explicit decision below is the only one that takes effect.
 */
export function poolConfigFor(
  connectionString: string,
  sslMode = process.env.POSTGRES_SSL_MODE,
  caCert = process.env.POSTGRES_CA_CERT,
): {
  connectionString: string;
  ssl: false | { rejectUnauthorized: boolean; ca?: string };
} {
  const url = new URL(connectionString);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  url.searchParams.delete("sslmode");
  if (isLocal || sslMode === "disable") {
    return { connectionString: url.toString(), ssl: false };
  }
  if (sslMode === "no-verify") {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "POSTGRES_SSL_MODE=no-verify: database TLS certificate verification is DISABLED by explicit configuration",
      }),
    );
    return { connectionString: url.toString(), ssl: { rejectUnauthorized: false } };
  }
  return { connectionString: url.toString(), ssl: caCert ? { rejectUnauthorized: true, ca: caCert } : { rejectUnauthorized: true } };
}

interface TurnRecordRow extends QueryResultRow {
  account_id: string;
  client_turn_id: string;
  status: TurnRecordStatus;
  conversation_id: string | null;
  fingerprint: string | null;
  result: unknown;
  created_at: Date;
  updated_at: Date;
}

function toTurnRecord(row: TurnRecordRow): TurnRecord {
  return {
    accountId: row.account_id,
    clientTurnId: row.client_turn_id,
    status: row.status,
    conversationId: row.conversation_id ?? undefined,
    fingerprint: row.fingerprint ?? undefined,
    result: row.result ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
