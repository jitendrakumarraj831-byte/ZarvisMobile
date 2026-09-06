import { randomUUID } from "node:crypto";
import { Pool, type QueryResultRow } from "pg";
import type { PermissionType, Task } from "../domain/types.js";
import type { Account, Store, TrialRecord, UsageEntry, User } from "./store.js";

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
    this.pool = new Pool({ connectionString, max: 5, ssl: sslConfigFor(connectionString) });
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.pool.query(SCHEMA).then(() => undefined);
    }
    return this.schemaReady;
  }

  private async query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
    await this.ensureSchema();
    return this.pool.query<T>(text, params);
  }

  async createUser(email: string, passwordHash: string): Promise<User> {
    const id = randomUUID();
    const createdAt = new Date();
    try {
      await this.query(
        "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)",
        [id, email, passwordHash, createdAt],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(`A user with email '${email}' already exists`);
      }
      throw err;
    }
    return { id, email, passwordHash, createdAt };
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
      `WITH inserted AS (
         INSERT INTO usage_ledger (id, account_id, skill_id, cost, task_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
       ), updated AS (
         UPDATE credit_balances SET balance = balance - $4 WHERE account_id = $2 RETURNING balance
       )
       SELECT balance FROM updated`,
      [entry.id, entry.accountId, entry.skillId, entry.cost, entry.taskId ?? null, entry.createdAt],
    );
    return rows[0] ? Number(rows[0].balance) : -entry.cost;
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
  created_at: Date;
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

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, passwordHash: row.password_hash, createdAt: row.created_at };
}

function toAccount(row: AccountRow): Account {
  return { id: row.id, userId: row.user_id, plan: row.plan, createdAt: row.created_at };
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

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "23505";
}

/**
 * Hosted Postgres (Vercel Postgres/Neon, Supabase, Heroku, ...) requires TLS but node-pg's
 * default strict certificate verification rejects their certs in most Node runtimes,
 * failing every query with "self-signed certificate in certificate chain" — the standard
 * fix, per every one of those providers' own node-postgres docs, is to keep the channel
 * encrypted but skip chain verification. A local/test database (this repo's own
 * test/store/postgresStore.test.ts included) has no TLS listener at all, so forcing `ssl`
 * on it would break the connection instead of fixing anything — only remote hosts get it.
 */
function sslConfigFor(connectionString: string): false | { rejectUnauthorized: false } {
  const hostname = new URL(connectionString).hostname;
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  return isLocal ? false : { rejectUnauthorized: false };
}
