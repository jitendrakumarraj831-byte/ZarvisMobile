import type { ActionClass, EntitlementLevel, PermissionType, RiskLevel, Task } from "../domain/types.js";

export class InsufficientCreditsError extends Error {
  constructor(accountId: string) {
    super(`Insufficient credits for account '${accountId}'`);
    this.name = "InsufficientCreditsError";
  }
}

export class EmailTakenError extends Error {
  constructor() {
    super("An account with this email already exists");
    this.name = "EmailTakenError";
  }
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  /** A device-bootstrapped guest with a generated email; can be linked to a real email. */
  isGuest: boolean;
  createdAt: Date;
}

/** One signed-in device/browser. Refresh tokens rotate; only the latest one is valid. */
export interface AuthSession {
  id: string;
  userId: string;
  accountId: string;
  /** sha256 of the current refresh token's `jti` — the raw token is never stored. */
  refreshTokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date;
  revokedAt?: Date;
}

export type ConfirmationStatus = "PENDING" | "APPROVED" | "DECLINED";

/** A server-issued, account-bound, single-use, expiring approval for one exact tool call. */
export interface ConfirmationRecord {
  id: string;
  accountId: string;
  skillId: string;
  input: Record<string, unknown>;
  inputHash: string;
  action: string;
  riskLevel: RiskLevel;
  actionClass: ActionClass;
  conversationId?: string;
  status: ConfirmationStatus;
  createdAt: Date;
  expiresAt: Date;
  resolvedAt?: Date;
}

/** A user's own GitHub credential. The token is only ever stored encrypted. */
export interface GitHubConnection {
  accountId: string;
  encryptedToken: string;
  githubLogin: string;
  scopes: string;
  connectedAt: Date;
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

export type ConversationRole = "user" | "assistant" | "tool";

export interface Conversation {
  id: string;
  accountId: string;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: ConversationRole;
  content: string;
  createdAt: Date;
}

/**
 * Storage boundary. Two implementations ship against this interface: InMemoryStore
 * (local dev/tests only — its state does not survive a process restart or serverless cold
 * start) and PostgresStore (used automatically once POSTGRES_URL/DATABASE_URL is set — see
 * container.ts). See MASTER_SPEC.md §31 and DEVELOPMENT.md.
 */
export interface Store {
  createUser(email: string, passwordHash: string, isGuest?: boolean): Promise<User>;
  /** Links a guest to a real email/password (isGuest becomes false). Throws EmailTakenError. */
  updateUserCredentials(userId: string, email: string, passwordHash: string): Promise<User>;
  findUserByEmail(email: string): Promise<User | undefined>;
  findUserById(id: string): Promise<User | undefined>;

  /** Creates an account for the user and starts its one lifetime trial. See SUBSCRIPTIONS.md. */
  createAccountForUser(userId: string): Promise<Account>;
  getAccount(accountId: string): Promise<Account | undefined>;
  getAccountByUserId(userId: string): Promise<Account | undefined>;
  /** Updates the account's plan (e.g. after a verified Play Billing purchase). Throws if the account is unknown. */
  updateAccountPlan(accountId: string, plan: EntitlementLevel): Promise<Account>;
  /**
   * Deletes the account and everything scoped to it (trial, credit balance, usage ledger,
   * granted permissions, tasks) along with its user record, so a deleted account cannot log
   * back in — see MASTER_SPEC.md §17 "delete account (cascades: memory, tasks, usage
   * history, ...)" (there is no separate memory table yet; nothing else to cascade there).
   * Throws if the account is unknown.
   */
  deleteAccount(accountId: string): Promise<void>;

  getTrial(accountId: string): Promise<TrialRecord | undefined>;
  getCreditBalance(accountId: string): Promise<number>;
  /**
   * Deducts entry.cost from the account balance and appends to the ledger.
   * Throws InsufficientCreditsError when the balance cannot cover the cost.
   */
  recordUsage(entry: UsageEntry): Promise<number>;
  /**
   * Records a verified purchase token the first time it is seen.
   * Returns false when that token was already consumed, including by another account.
   */
  claimPurchaseToken(purchaseToken: string, accountId: string, productId: string): Promise<boolean>;
  listUsage(accountId: string): Promise<UsageEntry[]>;

  createConversation(accountId: string, title?: string): Promise<Conversation>;
  getConversation(accountId: string, conversationId: string): Promise<Conversation | undefined>;
  listConversations(accountId: string): Promise<Conversation[]>;
  appendConversationMessages(messages: ConversationMessage[]): Promise<void>;
  listConversationMessages(accountId: string, conversationId: string, limit?: number): Promise<ConversationMessage[]>;

  grantedPermissions(accountId: string): Promise<Set<PermissionType>>;
  grantPermission(accountId: string, permission: PermissionType): Promise<void>;

  createSession(session: AuthSession): Promise<AuthSession>;
  getSession(sessionId: string): Promise<AuthSession | undefined>;
  /** Atomic compare-and-set of the refresh hash; false when `expectedHash` is not current or the session is revoked/expired. */
  rotateSession(sessionId: string, expectedHash: string, newHash: string, newExpiresAt: Date, now: Date): Promise<boolean>;
  revokeSession(sessionId: string, now: Date): Promise<void>;

  createConfirmation(record: ConfirmationRecord): Promise<ConfirmationRecord>;
  getConfirmation(accountId: string, confirmationId: string): Promise<ConfirmationRecord | undefined>;
  /**
   * Atomically moves a PENDING, unexpired confirmation owned by `accountId` to `status`.
   * Returns undefined when it is missing, owned by someone else, expired or already resolved —
   * which is what makes an approval single-use.
   */
  resolveConfirmation(
    accountId: string,
    confirmationId: string,
    status: Exclude<ConfirmationStatus, "PENDING">,
    now: Date,
  ): Promise<ConfirmationRecord | undefined>;

  saveGitHubConnection(connection: GitHubConnection): Promise<void>;
  getGitHubConnection(accountId: string): Promise<GitHubConnection | undefined>;
  deleteGitHubConnection(accountId: string): Promise<void>;

  createTask(task: Task): Promise<Task>;
  getTask(taskId: string): Promise<Task | undefined>;
  updateTask(task: Task): Promise<Task>;
  listTasksForAccount(accountId: string): Promise<Task[]>;
}
