import { randomUUID } from "node:crypto";
import { Pool, type QueryResultRow } from "pg";
import type { PermissionType, Task } from "../domain/types.js";
import {
  EmailTakenError,
  InsufficientCreditsError,
  type Account, type AuthSession, type ConfirmationRecord, type ConfirmationStatus, type Conversation,
  type ConversationMessage, type GitHubConnection, type Store, type StoreHealth, type TrialRecord, type UsageEntry, type User
} from "./store.js";

const TRIAL_DURATION_DAYS = 14;
const TRIAL_INCLUDED_CREDITS = 50;

const SCHEMA = `
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
    const { rows } = await this.query<SessionRow>("SELECT * FROM auth_sessions WHERE id = $1", [sessionId]);
    return rows[0] ? toSession(rows[0]) : undefined;
  }

  async rotateSession(sessionId: string, expectedHash: string, newHash: string, newExpiresAt: Date, now: Date): Promise<boolean> {
    const { rowCount } = await this.query(
      `UPDATE auth_sessions SET refresh_token_hash = $3, expires_at = $4, last_used_at = $5
       WHERE id = $1 AND refresh_token_hash = $2 AND revoked_at IS NULL AND expires_at > $5`,
      [sessionId, expectedHash, newHash, newExpiresAt, now],
    );
    return rowCount === 1;
  }

  async revokeSession(sessionId: string, now: Date): Promise<void> {
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
      const { rows } = await client.query<AccountRow>("SELECT * FROM accounts WHERE id = $1 FOR UPDATE", [
        accountId,
      ]);
      const account = rows[0];
      if (!account) {
        throw new Error(`Cannot delete unknown account '${accountId}'`);
      }
      await client.query("DELETE FROM usage_ledger WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM auth_sessions WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM confirmations WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM github_connections WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM account_permissions WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM trials WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM credit_balances WHERE account_id = $1", [accountId]);
      await client.query("DELETE FROM tasks WHERE account_id = $1", [accountId]);
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

interface AccountRow {
  id: string;
  user_id: string;
  plan: Account["plan"];
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
  return { id: row.id, userId: row.user_id, plan: row.plan, createdAt: row.created_at };
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
