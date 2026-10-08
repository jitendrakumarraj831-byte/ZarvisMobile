import { randomUUID } from "node:crypto";
import { taskLifecycle, type PermissionType, type Task, type TaskLifecycle } from "../domain/types.js";
import type { Project, ProjectStatus, ToolExecutionRecord, WorkspaceFile, WorkspaceFileSummary, WorkspaceNote, WorkspaceNoteKind } from "../domain/workspace.js";
import {
  EmailTakenError,
  GoogleIdentityTakenError,
  type GoogleIdentityInput,
  InsufficientCreditsError,
  extendPlanExpiry, type Account, type AuthSession, type ConfirmationRecord, type ConfirmationStatus, type Conversation,
  type ConversationMessage, type FulfillmentResult, type GitHubConnection, type PaymentOrder, type Store, type StoreHealth, type TrialRecord, type TurnClaim,
  type TurnRecord, type TurnRecordStatus, type UsageEntry, type User, TURN_RECORD_RETENTION_MS
} from "./store.js";

const TRIAL_DURATION_DAYS = 14;
const TRIAL_INCLUDED_CREDITS = 50;

/**
 * Default local-dev/test store — see store.ts for the interface this must keep matching.
 * Not for production use (no persistence across process restarts, no concurrency control
 * beyond Node's single-threaded event loop).
 */
export class InMemoryStore implements Store {
  /** No database: state lives in this process only (it does not survive a serverless cold start). */
  async healthCheck(): Promise<StoreHealth> {
    return "not_configured";
  }

  private readonly usersById = new Map<string, User>();
  private readonly usersByEmail = new Map<string, string>();
  private readonly accountsById = new Map<string, Account>();
  private readonly accountsByUserId = new Map<string, string>();
  private readonly trials = new Map<string, TrialRecord>();
  private readonly creditBalances = new Map<string, number>();
  private readonly usageLedger: UsageEntry[] = [];
  private readonly permissions = new Map<string, Set<PermissionType>>();
  private readonly tasks = new Map<string, Task>();
  private readonly conversations = new Map<string, Conversation>();
  private readonly conversationMessages = new Map<string, ConversationMessage[]>();
  private readonly purchaseTokens = new Set<string>();
  private readonly sessions = new Map<string, AuthSession>();
  private readonly confirmations = new Map<string, ConfirmationRecord>();
  private readonly githubConnections = new Map<string, GitHubConnection>();
  /** Keyed by `${accountId}\u0000${clientTurnId}`. */
  private readonly turnRecords = new Map<string, TurnRecord>();
  private readonly projects = new Map<string, Project>();
  private readonly notes = new Map<string, WorkspaceNote>();
  private readonly files = new Map<string, WorkspaceFile>();
  private readonly executions = new Map<string, ToolExecutionRecord>();

  async createUser(email: string, passwordHash: string, isGuest = false): Promise<User> {
    if (this.usersByEmail.has(email)) {
      throw new EmailTakenError();
    }
    const user: User = { id: randomUUID(), email, passwordHash, isGuest, createdAt: new Date() };
    this.usersById.set(user.id, user);
    this.usersByEmail.set(email, user.id);
    return user;
  }

  async updateUserCredentials(userId: string, email: string, passwordHash: string): Promise<User> {
    const user = this.usersById.get(userId);
    if (!user) throw new Error(`Cannot update unknown user '${userId}'`);
    const owner = this.usersByEmail.get(email);
    if (owner && owner !== userId) throw new EmailTakenError();
    this.usersByEmail.delete(user.email);
    const updated: User = { ...user, email, passwordHash, isGuest: false };
    this.usersById.set(userId, updated);
    this.usersByEmail.set(email, userId);
    return updated;
  }

  async findUserByGoogleSub(sub: string): Promise<User | undefined> {
    for (const user of this.usersById.values()) if (user.googleSub === sub) return user;
    return undefined;
  }

  async linkGoogleIdentity(userId: string, identity: GoogleIdentityInput, options: { convertGuest?: boolean } = {}): Promise<User> {
    const user = this.usersById.get(userId);
    if (!user) throw new Error(`Cannot link unknown user '${userId}'`);
    const subOwner = await this.findUserByGoogleSub(identity.sub);
    if (subOwner && subOwner.id !== userId) throw new GoogleIdentityTakenError();
    let email = user.email;
    if (options.convertGuest) {
      const owner = this.usersByEmail.get(identity.email);
      if (owner && owner !== userId) throw new EmailTakenError();
      this.usersByEmail.delete(user.email);
      this.usersByEmail.set(identity.email, userId);
      email = identity.email;
    }
    const updated: User = {
      ...user,
      email,
      isGuest: options.convertGuest ? false : user.isGuest,
      googleSub: identity.sub,
      displayName: identity.name ?? user.displayName,
      avatarUrl: identity.picture ?? user.avatarUrl,
    };
    this.usersById.set(userId, updated);
    return updated;
  }

  async createSession(session: AuthSession): Promise<AuthSession> {
    this.sessions.set(session.id, { ...session });
    return session;
  }

  async getSession(sessionId: string): Promise<AuthSession | undefined> {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : undefined;
  }

  async rotateSession(sessionId: string, expectedHash: string, newHash: string, newExpiresAt: Date, now: Date): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.revokedAt || session.expiresAt <= now || session.refreshTokenHash !== expectedHash) return false;
    session.refreshTokenHash = newHash;
    session.expiresAt = newExpiresAt;
    session.lastUsedAt = now;
    return true;
  }

  async revokeSession(sessionId: string, now: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session && !session.revokedAt) session.revokedAt = now;
  }

  async createConfirmation(record: ConfirmationRecord): Promise<ConfirmationRecord> {
    this.confirmations.set(record.id, structuredClone(record));
    return record;
  }

  async getConfirmation(accountId: string, confirmationId: string): Promise<ConfirmationRecord | undefined> {
    const record = this.confirmations.get(confirmationId);
    return record && record.accountId === accountId ? structuredClone(record) : undefined;
  }

  async resolveConfirmation(
    accountId: string,
    confirmationId: string,
    status: Exclude<ConfirmationStatus, "PENDING">,
    now: Date,
  ): Promise<ConfirmationRecord | undefined> {
    const record = this.confirmations.get(confirmationId);
    if (!record || record.accountId !== accountId || record.status !== "PENDING" || record.expiresAt <= now) {
      return undefined;
    }
    record.status = status;
    record.resolvedAt = now;
    return structuredClone(record);
  }

  async saveGitHubConnection(connection: GitHubConnection): Promise<void> {
    this.githubConnections.set(connection.accountId, { ...connection });
  }

  async getGitHubConnection(accountId: string): Promise<GitHubConnection | undefined> {
    const connection = this.githubConnections.get(accountId);
    return connection ? { ...connection } : undefined;
  }

  async deleteGitHubConnection(accountId: string): Promise<void> {
    this.githubConnections.delete(accountId);
  }

  async findUserByEmail(email: string): Promise<User | undefined> {
    const id = this.usersByEmail.get(email);
    return id ? this.usersById.get(id) : undefined;
  }

  async findUserById(id: string): Promise<User | undefined> {
    return this.usersById.get(id);
  }

  async createAccountForUser(userId: string): Promise<Account> {
    const account: Account = { id: randomUUID(), userId, plan: "TRIAL", createdAt: new Date() };
    this.accountsById.set(account.id, account);
    this.accountsByUserId.set(userId, account.id);

    const now = new Date();
    this.trials.set(account.id, {
      accountId: account.id,
      startsAt: now,
      expiresAt: new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000),
      includedCredits: TRIAL_INCLUDED_CREDITS,
    });
    this.creditBalances.set(account.id, TRIAL_INCLUDED_CREDITS);

    return account;
  }

  async getAccount(accountId: string): Promise<Account | undefined> {
    return this.accountsById.get(accountId);
  }

  async getAccountByUserId(userId: string): Promise<Account | undefined> {
    const id = this.accountsByUserId.get(userId);
    return id ? this.accountsById.get(id) : undefined;
  }

  async updateAccountPlan(accountId: string, plan: Account["plan"]): Promise<Account> {
    const existing = this.accountsById.get(accountId);
    if (!existing) {
      throw new Error(`Cannot update unknown account '${accountId}'`);
    }
    const updated: Account = { ...existing, plan };
    this.accountsById.set(accountId, updated);
    return updated;
  }

  async deleteAccount(accountId: string): Promise<void> {
    const account = this.accountsById.get(accountId);
    if (!account) {
      throw new Error(`Cannot delete unknown account '${accountId}'`);
    }
    this.trials.delete(accountId);
    this.creditBalances.delete(accountId);
    this.githubConnections.delete(accountId);
    for (const [orderId, order] of this.paymentOrders) {
      if (order.accountId === accountId) this.paymentOrders.delete(orderId);
    }
    for (const [sessionId, session] of this.sessions) {
      if (session.accountId === accountId) this.sessions.delete(sessionId);
    }
    for (const [confirmationId, record] of this.confirmations) {
      if (record.accountId === accountId) this.confirmations.delete(confirmationId);
    }
    this.permissions.delete(accountId);
    for (const [key, record] of this.turnRecords) {
      if (record.accountId === accountId) this.turnRecords.delete(key);
    }
    for (const [conversationId, conversation] of this.conversations) {
      if (conversation.accountId === accountId) {
        this.conversations.delete(conversationId);
        this.conversationMessages.delete(conversationId);
      }
    }
    for (const [taskId, task] of this.tasks) {
      if (task.accountId === accountId) this.tasks.delete(taskId);
    }
    for (const map of [this.projects, this.notes, this.files, this.executions] as Array<Map<string, { accountId: string }>>) {
      for (const [id, record] of map) if (record.accountId === accountId) map.delete(id);
    }
    for (let i = this.usageLedger.length - 1; i >= 0; i -= 1) {
      if (this.usageLedger[i]!.accountId === accountId) this.usageLedger.splice(i, 1);
    }
    this.accountsById.delete(accountId);
    this.accountsByUserId.delete(account.userId);
    const user = this.usersById.get(account.userId);
    this.usersById.delete(account.userId);
    if (user) this.usersByEmail.delete(user.email);
  }

  async getTrial(accountId: string): Promise<TrialRecord | undefined> {
    return this.trials.get(accountId);
  }

  async getCreditBalance(accountId: string): Promise<number> {
    return this.creditBalances.get(accountId) ?? 0;
  }

  async recordUsage(entry: UsageEntry): Promise<number> {
    const current = this.creditBalances.get(entry.accountId) ?? 0;
    if (current < entry.cost) {
      throw new InsufficientCreditsError(entry.accountId);
    }
    this.usageLedger.push(entry);
    const newBalance = current - entry.cost;
    this.creditBalances.set(entry.accountId, newBalance);
    return newBalance;
  }

  private readonly paymentOrders = new Map<string, PaymentOrder>();

  async createPaymentOrder(order: PaymentOrder): Promise<void> {
    this.paymentOrders.set(order.orderId, { ...order });
  }

  async getPaymentOrder(orderId: string): Promise<PaymentOrder | undefined> {
    const order = this.paymentOrders.get(orderId);
    return order ? { ...order } : undefined;
  }

  async fulfillPaymentOrder(orderId: string, paymentId: string, now: Date): Promise<FulfillmentResult> {
    const order = this.paymentOrders.get(orderId);
    if (!order) return { status: "not_found" };
    if (order.status === "paid") return { status: "already_fulfilled" };
    const account = this.accountsById.get(order.accountId);
    if (!account) return { status: "not_found" };
    const updated = { ...account, plan: "PRO" as const, planExpiresAt: extendPlanExpiry(account, order.periodDays, now) };
    this.accountsById.set(account.id, updated);
    const balance = (this.creditBalances.get(account.id) ?? 0) + order.credits;
    this.creditBalances.set(account.id, balance);
    this.paymentOrders.set(orderId, { ...order, status: "paid", paymentId, paidAt: now });
    return { status: "fulfilled", account: updated, creditBalance: balance };
  }

  async claimPurchaseToken(purchaseToken: string, _accountId: string, _productId: string): Promise<boolean> {
    if (this.purchaseTokens.has(purchaseToken)) return false;
    this.purchaseTokens.add(purchaseToken);
    return true;
  }

  async listUsage(accountId: string): Promise<UsageEntry[]> {
    return this.usageLedger.filter((entry) => entry.accountId === accountId);
  }

  async createConversation(accountId: string, title?: string, projectId?: string): Promise<Conversation> {
    const now = new Date();
    const conversation: Conversation = {
      id: randomUUID(),
      accountId,
      title: title?.trim().slice(0, 120) || undefined,
      ...(projectId ? { projectId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(conversation.id, conversation);
    this.conversationMessages.set(conversation.id, []);
    return conversation;
  }

  async getConversation(accountId: string, conversationId: string): Promise<Conversation | undefined> {
    const conversation = this.conversations.get(conversationId);
    return conversation?.accountId === accountId ? conversation : undefined;
  }

  async setConversationProject(accountId: string, conversationId: string, projectId: string | null): Promise<Conversation | undefined> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || conversation.accountId !== accountId) return undefined;
    if (projectId) conversation.projectId = projectId;
    else delete conversation.projectId;
    return conversation;
  }

  async listConversations(accountId: string, limit?: number, filter: { projectId?: string } = {}): Promise<Conversation[]> {
    const newestFirst = [...this.conversations.values()]
      .filter((conversation) => conversation.accountId === accountId && (!filter.projectId || conversation.projectId === filter.projectId))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return limit === undefined ? newestFirst : newestFirst.slice(0, limit);
  }

  async appendConversationMessages(messages: ConversationMessage[]): Promise<void> {
    for (const message of messages) {
      const conversation = this.conversations.get(message.conversationId);
      if (!conversation) {
        throw new Error("Conversation not found");
      }
      const list = this.conversationMessages.get(message.conversationId) ?? [];
      list.push(message);
      this.conversationMessages.set(message.conversationId, list);
      conversation.updatedAt = message.createdAt;
    }
  }

  async listConversationMessages(accountId: string, conversationId: string, limit = 40): Promise<ConversationMessage[]> {
    const conversation = await this.getConversation(accountId, conversationId);
    if (!conversation) return [];
    const list = this.conversationMessages.get(conversationId) ?? [];
    return list.slice(-Math.max(1, Math.min(limit, 100)));
  }

  async grantedPermissions(accountId: string): Promise<Set<PermissionType>> {
    return this.permissions.get(accountId) ?? new Set();
  }

  async grantPermission(accountId: string, permission: PermissionType): Promise<void> {
    const existing = this.permissions.get(accountId) ?? new Set<PermissionType>();
    existing.add(permission);
    this.permissions.set(accountId, existing);
  }

  async claimTurn(accountId: string, clientTurnId: string, fingerprint: string, now: Date, staleBefore: Date): Promise<TurnClaim> {
    const expired = now.getTime() - TURN_RECORD_RETENTION_MS;
    for (const [key, record] of this.turnRecords) {
      if (record.accountId === accountId && record.updatedAt.getTime() < expired) this.turnRecords.delete(key);
    }
    const key = accountId + "\u0000" + clientTurnId;
    const existing = this.turnRecords.get(key);
    if (!existing) {
      this.turnRecords.set(key, { accountId, clientTurnId, fingerprint, status: "running", createdAt: now, updatedAt: now });
      return { kind: "claimed" };
    }
    if (existing.fingerprint && existing.fingerprint !== fingerprint) return { kind: "conflict" };
    if (existing.status === "completed") return { kind: "completed", record: { ...existing } };
    if (existing.status === "failed" || existing.updatedAt < staleBefore) {
      const previous = { ...existing };
      this.turnRecords.set(key, { ...existing, status: "running", updatedAt: now });
      return { kind: "claimed", previous };
    }
    return { kind: "in_progress" };
  }

  async updateTurn(
    accountId: string,
    clientTurnId: string,
    patch: { status?: TurnRecordStatus; conversationId?: string; result?: unknown },
    now: Date,
  ): Promise<void> {
    const key = accountId + "\u0000" + clientTurnId;
    const existing = this.turnRecords.get(key);
    if (!existing) return;
    this.turnRecords.set(key, {
      ...existing,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.conversationId ? { conversationId: patch.conversationId } : {}),
      ...(patch.result !== undefined ? { result: structuredClone(patch.result) } : {}),
      updatedAt: now,
    });
  }

  async createTask(task: Task): Promise<Task> {
    const stored: Task = { ...task, updatedAt: task.updatedAt ?? task.createdAt };
    this.tasks.set(task.id, structuredClone(stored));
    return stored;
  }

  async getTask(taskId: string): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    return task ? structuredClone(task) : undefined;
  }

  async updateTask(task: Task): Promise<Task> {
    if (!this.tasks.has(task.id)) {
      throw new Error(`Cannot update unknown task '${task.id}'`);
    }
    const stored: Task = { ...task, updatedAt: task.updatedAt ?? new Date() };
    this.tasks.set(task.id, structuredClone(stored));
    return stored;
  }

  async listTasksForAccount(accountId: string): Promise<Task[]> {
    return [...this.tasks.values()].filter((task) => task.accountId === accountId).map((task) => structuredClone(task));
  }

  async claimTaskRun(accountId: string, taskId: string, from: TaskLifecycle[], now: Date, staleBefore: Date): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    if (!task || task.accountId !== accountId) return undefined;
    const lifecycle = taskLifecycle(task);
    const midRun = lifecycle === "RUNNING" || lifecycle === "EXECUTING" || lifecycle === "VERIFYING";
    const lastTouched = (task.updatedAt ?? task.createdAt).getTime();
    const staleRun = midRun && lastTouched < staleBefore.getTime();
    if (!from.includes(lifecycle) && !staleRun) return undefined;
    const claimed: Task = { ...task, lifecycle: "RUNNING", status: "RUNNING", updatedAt: now };
    this.tasks.set(taskId, claimed);
    return structuredClone(claimed);
  }

  async createProject(project: Project): Promise<Project> {
    this.projects.set(project.id, structuredClone(project));
    return project;
  }

  async getProject(accountId: string, projectId: string): Promise<Project | undefined> {
    const project = this.projects.get(projectId);
    return project && project.accountId === accountId ? structuredClone(project) : undefined;
  }

  async listProjects(accountId: string, filter: { status?: ProjectStatus } = {}): Promise<Project[]> {
    return [...this.projects.values()]
      .filter((project) => project.accountId === accountId && (!filter.status || project.status === filter.status))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((project) => structuredClone(project));
  }

  async updateProject(project: Project): Promise<Project> {
    if (!this.projects.has(project.id)) throw new Error(`Cannot update unknown project '${project.id}'`);
    this.projects.set(project.id, structuredClone(project));
    return project;
  }

  async deleteProject(accountId: string, projectId: string): Promise<boolean> {
    const project = this.projects.get(projectId);
    if (!project || project.accountId !== accountId) return false;
    this.projects.delete(projectId);
    for (const [id, note] of this.notes) if (note.projectId === projectId) this.notes.delete(id);
    for (const conversation of this.conversations.values()) if (conversation.projectId === projectId) delete conversation.projectId;
    for (const task of this.tasks.values()) if (task.projectId === projectId) delete task.projectId;
    for (const file of this.files.values()) if (file.projectId === projectId) delete file.projectId;
    for (const execution of this.executions.values()) if (execution.projectId === projectId) delete execution.projectId;
    return true;
  }

  async createNote(note: WorkspaceNote): Promise<WorkspaceNote> {
    this.notes.set(note.id, structuredClone(note));
    return note;
  }

  async getNote(accountId: string, noteId: string): Promise<WorkspaceNote | undefined> {
    const note = this.notes.get(noteId);
    return note && note.accountId === accountId ? structuredClone(note) : undefined;
  }

  async listNotes(accountId: string, filter: { projectId?: string | null; kind?: WorkspaceNoteKind } = {}): Promise<WorkspaceNote[]> {
    return [...this.notes.values()]
      .filter((note) => note.accountId === accountId)
      .filter((note) => filter.projectId === undefined || (filter.projectId === null ? !note.projectId : note.projectId === filter.projectId))
      .filter((note) => !filter.kind || note.kind === filter.kind)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((note) => structuredClone(note));
  }

  async updateNote(note: WorkspaceNote): Promise<WorkspaceNote> {
    if (!this.notes.has(note.id)) throw new Error(`Cannot update unknown note '${note.id}'`);
    this.notes.set(note.id, structuredClone(note));
    return note;
  }

  async deleteNote(accountId: string, noteId: string): Promise<boolean> {
    const note = this.notes.get(noteId);
    if (!note || note.accountId !== accountId) return false;
    this.notes.delete(noteId);
    return true;
  }

  async deletePersonalMemory(accountId: string): Promise<number> {
    let removed = 0;
    for (const [id, note] of this.notes) {
      if (note.accountId === accountId && note.kind === "memory" && !note.projectId) {
        this.notes.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  async setMemoryEnabled(accountId: string, enabled: boolean): Promise<Account> {
    const account = this.accountsById.get(accountId);
    if (!account) throw new Error(`Cannot update unknown account '${accountId}'`);
    const updated: Account = { ...account, memoryEnabled: enabled };
    this.accountsById.set(accountId, updated);
    return updated;
  }

  async createFile(file: WorkspaceFile): Promise<WorkspaceFile> {
    this.files.set(file.id, structuredClone(file));
    return file;
  }

  async getFile(accountId: string, fileId: string): Promise<WorkspaceFile | undefined> {
    const file = this.files.get(fileId);
    return file && file.accountId === accountId ? structuredClone(file) : undefined;
  }

  async listFiles(accountId: string, filter: { projectId?: string | null; limit?: number } = {}): Promise<WorkspaceFileSummary[]> {
    const newestFirst = [...this.files.values()]
      .filter((file) => file.accountId === accountId)
      .filter((file) => filter.projectId === undefined || (filter.projectId === null ? !file.projectId : file.projectId === filter.projectId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(({ text, ...rest }) => ({ ...structuredClone(rest), textLength: text.length }));
    return filter.limit === undefined ? newestFirst : newestFirst.slice(0, filter.limit);
  }

  async updateFile(file: WorkspaceFile): Promise<WorkspaceFile> {
    if (!this.files.has(file.id)) throw new Error(`Cannot update unknown file '${file.id}'`);
    this.files.set(file.id, structuredClone(file));
    return file;
  }

  async deleteFile(accountId: string, fileId: string): Promise<boolean> {
    const file = this.files.get(fileId);
    if (!file || file.accountId !== accountId) return false;
    this.files.delete(fileId);
    return true;
  }

  async recordExecution(record: ToolExecutionRecord): Promise<void> {
    this.executions.set(record.id, structuredClone(record));
  }

  async getExecution(accountId: string, executionId: string): Promise<ToolExecutionRecord | undefined> {
    const record = this.executions.get(executionId);
    return record && record.accountId === accountId ? structuredClone(record) : undefined;
  }

  async listExecutions(
    accountId: string,
    filter: { conversationId?: string; projectId?: string; taskId?: string; skillIds?: string[]; limit?: number } = {},
  ): Promise<ToolExecutionRecord[]> {
    const newestFirst = [...this.executions.values()]
      .filter((record) => record.accountId === accountId)
      .filter((record) => !filter.conversationId || record.conversationId === filter.conversationId)
      .filter((record) => !filter.projectId || record.projectId === filter.projectId)
      .filter((record) => !filter.taskId || record.taskId === filter.taskId)
      .filter((record) => !filter.skillIds || filter.skillIds.includes(record.skillId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((record) => structuredClone(record));
    return filter.limit === undefined ? newestFirst : newestFirst.slice(0, filter.limit);
  }
}
