import type { EntitlementLevel, PermissionType, Task } from "../domain/types.js";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface Account {
  id: string;
  userId: string;
  plan: EntitlementLevel;
  createdAt: Date;
}

export interface TrialRecord {
  accountId: string;
  startsAt: Date;
  expiresAt: Date;
  includedCredits: number;
}

export interface UsageEntry {
  id: string;
  accountId: string;
  skillId: string;
  cost: number;
  taskId?: string;
  createdAt: Date;
}

/**
 * Storage boundary. Two implementations ship against this interface: InMemoryStore
 * (local dev/tests only — its state does not survive a process restart or serverless cold
 * start) and PostgresStore (used automatically once POSTGRES_URL/DATABASE_URL is set — see
 * container.ts). See MASTER_SPEC.md §31 and DEVELOPMENT.md.
 */
export interface Store {
  createUser(email: string, passwordHash: string): Promise<User>;
  findUserByEmail(email: string): Promise<User | undefined>;
  findUserById(id: string): Promise<User | undefined>;

  /** Creates an account for the user and starts its one lifetime trial. See SUBSCRIPTIONS.md. */
  createAccountForUser(userId: string): Promise<Account>;
  getAccount(accountId: string): Promise<Account | undefined>;
  getAccountByUserId(userId: string): Promise<Account | undefined>;

  getTrial(accountId: string): Promise<TrialRecord | undefined>;
  getCreditBalance(accountId: string): Promise<number>;
  /** Deducts entry.cost from the account balance and appends to the append-only ledger. */
  recordUsage(entry: UsageEntry): Promise<number>;
  listUsage(accountId: string): Promise<UsageEntry[]>;

  grantedPermissions(accountId: string): Promise<Set<PermissionType>>;
  grantPermission(accountId: string, permission: PermissionType): Promise<void>;

  createTask(task: Task): Promise<Task>;
  getTask(taskId: string): Promise<Task | undefined>;
  updateTask(task: Task): Promise<Task>;
  listTasksForAccount(accountId: string): Promise<Task[]>;
}
