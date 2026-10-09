import type { ActionClass, EntitlementLevel, PermissionType, RiskLevel, Task, TaskLifecycle } from "../domain/types.js";
import type { Project, ProjectStatus, ToolExecutionRecord, WorkspaceFile, WorkspaceFileSummary, WorkspaceNote, WorkspaceNoteKind } from "../domain/workspace.js";

export class InsufficientCreditsError extends Error {
  constructor(accountId: string) {
    super(`Insufficient credits for account '${accountId}'`);
    this.name = "InsufficientCreditsError";
  }
}

export class GoogleIdentityTakenError extends Error {
  constructor() {
    super("This Google account is already linked to another ZARVIS account");
    this.name = "GoogleIdentityTakenError";
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
  /** Google's stable account id when the user signed in with Google. */
  googleSub?: string;
  displayName?: string;
  avatarUrl?: string;
  createdAt: Date;
}

export interface GoogleIdentityInput {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
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
  /** The task whose step asked for this approval, so the task can report what the approval did. */
  taskId?: string;
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
  /** When a paid plan lapses (the account is then treated as FREE). Null/absent: no expiry. */
  planExpiresAt?: Date | null;
  /** Whether saved memory is given to the model. Absent means on. The user can pause it. */
  memoryEnabled?: boolean;
  createdAt: Date;
}

/** A Razorpay order created for one plan purchase. Price and grants are snapshotted at creation. */
export interface PaymentOrder {
  orderId: string;
  accountId: string;
  planKey: string;
  amountPaise: number;
  currency: "INR";
  periodDays: number;
  credits: number;
  status: "created" | "paid";
  paymentId?: string;
  createdAt: Date;
  paidAt?: Date;
}

export type FulfillmentResult =
  | { status: "fulfilled"; account: Account; creditBalance: number }
  | { status: "already_fulfilled" }
  | { status: "not_found" };

/**
 * New expiry when a paid period is bought: it stacks onto a still-running PRO period (renewing
 * early never wastes paid time) and otherwise starts now.
 */
export function extendPlanExpiry(account: Pick<Account, "plan" | "planExpiresAt">, periodDays: number, now: Date): Date {
  const running = account.plan === "PRO" && account.planExpiresAt && account.planExpiresAt.getTime() > now.getTime();
  const base = running ? (account.planExpiresAt as Date).getTime() : now.getTime();
  return new Date(base + periodDays * 24 * 60 * 60 * 1000);
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
  /** The project the chat belongs to, if the user started it in one or moved it there. */
  projectId?: string;
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
 * One logical user turn, keyed by the client's idempotency key (`clientTurnId`). A client that
 * re-sends the same turn (Retry after a dropped stream, a double submit) gets the stored result
 * of a completed turn instead of a second execution. `conversationId` is set once the user's
 * message has been persisted, so a retry of a failed attempt does not persist it twice.
 */
export type TurnRecordStatus = "running" | "completed" | "failed";

export interface TurnRecord {
  accountId: string;
  clientTurnId: string;
  status: TurnRecordStatus;
  conversationId?: string;
  /** sha256 of the utterance the key was first used with; a key is never reused for other text. */
  fingerprint?: string;
  /** The completed turn's result, replayed verbatim to a duplicate request. */
  result?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Outcome of claiming a turn:
 * - `claimed`: this request runs it. `previous` is the earlier failed (or abandoned) attempt
 *   when this is a retry.
 * - `in_progress`: another request is running it right now.
 * - `completed`: it already finished; `record.result` is what it returned.
 */
export type TurnClaim =
  | { kind: "claimed"; previous?: TurnRecord }
  | { kind: "in_progress" }
  | { kind: "completed"; record: TurnRecord }
  /** The key was first used with a different utterance. */
  | { kind: "conflict" };

/** How long a turn record (and so a replayable result) is kept. */
export const TURN_RECORD_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Storage boundary. Two implementations ship against this interface: InMemoryStore
 * (local dev/tests only — its state does not survive a process restart or serverless cold
 * start) and PostgresStore (used automatically once POSTGRES_URL/DATABASE_URL is set — see
 * container.ts). See MASTER_SPEC.md §31 and DEVELOPMENT.md.
 */
/**
 * Secret-free database status for /health. Lets an operator (and the live preview smoke test)
 * see *why* the database is unusable without exposing a connection string or error text.
 */
export type StoreHealth =
  | "ok"
  | "not_configured"
  | "tls_certificate_untrusted"
  | "auth_failed"
  | "unreachable"
  | "schema_error"
  | "error";

export interface Store {
  /** Checks the database can actually be used. Optional: stores without one report nothing. */
  healthCheck?(): Promise<StoreHealth>;
  createUser(email: string, passwordHash: string, isGuest?: boolean): Promise<User>;
  /** Links a guest to a real email/password (isGuest becomes false). Throws EmailTakenError. */
  updateUserCredentials(userId: string, email: string, passwordHash: string): Promise<User>;
  findUserByEmail(email: string): Promise<User | undefined>;
  findUserById(id: string): Promise<User | undefined>;
  findUserByGoogleSub(sub: string): Promise<User | undefined>;
  /**
   * Attaches a Google identity to an existing user and refreshes name/photo. With
   * `convertGuest`, a guest becomes a real account on the Google email (same user, same account,
   * nothing lost). Throws EmailTakenError / GoogleIdentityTakenError on a conflict.
   */
  linkGoogleIdentity(userId: string, identity: GoogleIdentityInput, options?: { convertGuest?: boolean }): Promise<User>;

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

  /** Records a Razorpay order the server just created for this account. */
  createPaymentOrder(order: PaymentOrder): Promise<void>;
  getPaymentOrder(orderId: string): Promise<PaymentOrder | undefined>;
  /**
   * Marks the order paid and grants its plan period and credits in ONE atomic step, exactly once:
   * a second call (client verify racing the webhook, a replay) returns "already_fulfilled" and
   * changes nothing.
   */
  fulfillPaymentOrder(orderId: string, paymentId: string, now: Date): Promise<FulfillmentResult>;
  listUsage(accountId: string): Promise<UsageEntry[]>;

  createConversation(accountId: string, title?: string, projectId?: string): Promise<Conversation>;
  getConversation(accountId: string, conversationId: string): Promise<Conversation | undefined>;
  /** Newest first. `limit` caps the rows read (the list endpoint never needs an account's whole history). */
  listConversations(accountId: string, limit?: number, filter?: { projectId?: string }): Promise<Conversation[]>;
  /** Moves a chat into a project, or out of every project with `null`. Returns undefined for a chat that is not the account's. */
  setConversationProject(accountId: string, conversationId: string, projectId: string | null): Promise<Conversation | undefined>;
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

  /**
   * Atomically claims (accountId, clientTurnId) for execution. A `running` record last updated
   * before `staleBefore` (its request died) can be claimed again, like a `failed` one.
   */
  claimTurn(accountId: string, clientTurnId: string, fingerprint: string, now: Date, staleBefore: Date): Promise<TurnClaim>;
  updateTurn(
    accountId: string,
    clientTurnId: string,
    patch: { status?: TurnRecordStatus; conversationId?: string; result?: unknown },
    now: Date,
  ): Promise<void>;

  createTask(task: Task): Promise<Task>;
  getTask(taskId: string): Promise<Task | undefined>;
  updateTask(task: Task): Promise<Task>;
  /**
   * Like updateTask, but only when the stored task is still in one of `whileIn`. A write that raced with another (a step
   * finishing while the user cancelled) therefore never overwrites the other's result. Returns undefined when the task
   * is missing or has already left those states; the caller then re-reads it.
   */
  updateTaskIf(task: Task, whileIn: TaskLifecycle[]): Promise<Task | undefined>;
  listTasksForAccount(accountId: string): Promise<Task[]>;
  /**
   * Atomically moves the account's task to `to` when it is in one of `from`, or when it is mid-run
   * (RUNNING/EXECUTING/VERIFYING) and has not been touched since `staleBefore` (its request died).
   * Returns the updated task, or undefined when it is missing, not the account's, or already
   * running elsewhere. This is what keeps two Run clicks from executing the same step twice.
   */
  claimTaskRun(accountId: string, taskId: string, from: TaskLifecycle[], now: Date, staleBefore: Date): Promise<Task | undefined>;

  createProject(project: Project): Promise<Project>;
  getProject(accountId: string, projectId: string): Promise<Project | undefined>;
  /** Newest activity first. */
  listProjects(accountId: string, filter?: { status?: ProjectStatus }): Promise<Project[]>;
  updateProject(project: Project): Promise<Project>;
  /** Removes the project and its notes; its chats, tasks and files stay and become unassigned. */
  deleteProject(accountId: string, projectId: string): Promise<boolean>;

  createNote(note: WorkspaceNote): Promise<WorkspaceNote>;
  getNote(accountId: string, noteId: string): Promise<WorkspaceNote | undefined>;
  /** `projectId: null` lists the notes that belong to no project (personal memory, loose research). Oldest first. */
  listNotes(accountId: string, filter?: { projectId?: string | null; kind?: WorkspaceNoteKind }): Promise<WorkspaceNote[]>;
  updateNote(note: WorkspaceNote): Promise<WorkspaceNote>;
  deleteNote(accountId: string, noteId: string): Promise<boolean>;
  /** Deletes every personal-memory note of the account (the "forget everything" action). Returns how many. */
  deletePersonalMemory(accountId: string): Promise<number>;
  setMemoryEnabled(accountId: string, enabled: boolean): Promise<Account>;

  createFile(file: WorkspaceFile): Promise<WorkspaceFile>;
  getFile(accountId: string, fileId: string): Promise<WorkspaceFile | undefined>;
  /** Newest first, without the text. `projectId: null` lists the files that belong to no project. */
  listFiles(accountId: string, filter?: { projectId?: string | null; limit?: number }): Promise<WorkspaceFileSummary[]>;
  updateFile(file: WorkspaceFile): Promise<WorkspaceFile>;
  deleteFile(accountId: string, fileId: string): Promise<boolean>;

  recordExecution(record: ToolExecutionRecord): Promise<void>;
  getExecution(accountId: string, executionId: string): Promise<ToolExecutionRecord | undefined>;
  /** Newest first. */
  listExecutions(
    accountId: string,
    filter?: { conversationId?: string; projectId?: string; taskId?: string; skillIds?: string[]; limit?: number },
  ): Promise<ToolExecutionRecord[]>;
}
