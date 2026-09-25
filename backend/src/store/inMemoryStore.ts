import { randomUUID } from "node:crypto";
import type { PermissionType, Task } from "../domain/types.js";
import type {
  Account, Conversation, ConversationMessage, Store, TrialRecord, UsageEntry, User
} from "./store.js";

const TRIAL_DURATION_DAYS = 14;
const TRIAL_INCLUDED_CREDITS = 50;

/**
 * Default local-dev/test store — see store.ts for the interface this must keep matching.
 * Not for production use (no persistence across process restarts, no concurrency control
 * beyond Node's single-threaded event loop).
 */
export class InMemoryStore implements Store {
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

  async createUser(email: string, passwordHash: string): Promise<User> {
    if (this.usersByEmail.has(email)) {
      throw new Error(`A user with email '${email}' already exists`);
    }
    const user: User = { id: randomUUID(), email, passwordHash, createdAt: new Date() };
    this.usersById.set(user.id, user);
    this.usersByEmail.set(email, user.id);
    return user;
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
    this.permissions.delete(accountId);
    for (const [conversationId, conversation] of this.conversations) {
      if (conversation.accountId === accountId) {
        this.conversations.delete(conversationId);
        this.conversationMessages.delete(conversationId);
      }
    }
    for (const [taskId, task] of this.tasks) {
      if (task.accountId === accountId) this.tasks.delete(taskId);
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
    this.usageLedger.push(entry);
    const newBalance = (this.creditBalances.get(entry.accountId) ?? 0) - entry.cost;
    this.creditBalances.set(entry.accountId, newBalance);
    return newBalance;
  }

  async listUsage(accountId: string): Promise<UsageEntry[]> {
    return this.usageLedger.filter((entry) => entry.accountId === accountId);
  }

  async createConversation(accountId: string, title?: string): Promise<Conversation> {
    const now = new Date();
    const conversation: Conversation = {
      id: randomUUID(),
      accountId,
      title: title?.trim().slice(0, 120) || undefined,
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

  async listConversations(accountId: string): Promise<Conversation[]> {
    return [...this.conversations.values()]
      .filter((conversation) => conversation.accountId === accountId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
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

  async createTask(task: Task): Promise<Task> {
    this.tasks.set(task.id, task);
    return task;
  }

  async getTask(taskId: string): Promise<Task | undefined> {
    return this.tasks.get(taskId);
  }

  async updateTask(task: Task): Promise<Task> {
    if (!this.tasks.has(task.id)) {
      throw new Error(`Cannot update unknown task '${task.id}'`);
    }
    this.tasks.set(task.id, task);
    return task;
  }

  async listTasksForAccount(accountId: string): Promise<Task[]> {
    return [...this.tasks.values()].filter((task) => task.accountId === accountId);
  }
}
