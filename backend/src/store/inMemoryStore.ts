import { randomUUID } from "node:crypto";
import type { PermissionType, Task } from "../domain/types.js";
import type { Account, Store, TrialRecord, UsageEntry, User } from "./store.js";

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
