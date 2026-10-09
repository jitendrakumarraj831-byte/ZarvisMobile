import { randomUUID } from "node:crypto";
import type { ConfirmationGrant, PendingConfirmationView, SkillExecutionContext } from "../domain/types.js";
import type { ConfirmationRecord, Store } from "../store/store.js";
import type { ClockPort, ConfirmationDecision, ConfirmationPort, ConfirmationRequest } from "../tooling/ports.js";
import { systemClockPort } from "../tooling/ports.js";
import { hashInput } from "../util/stableJson.js";

/** How long a pending confirmation can be approved before it expires. */
export const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

/**
 * Server-issued, single-action confirmations (blueprint §9, §17).
 *
 * - A call that needs confirmation and carries no valid grant creates a PENDING record bound
 *   to the account, the exact skill id and the sha256 of the exact input, with an expiry.
 * - Only `approve()` can turn that record into a grant: it atomically moves PENDING→APPROVED
 *   (so a second approve, a replay, another account, or an expired record all fail), and the
 *   pipeline then re-checks the grant against the skill id + input hash before executing.
 * - Clients never send a "confirmed" flag; there is nothing a client can set to skip this.
 */
export class ServerConfirmationService implements ConfirmationPort {
  constructor(
    private readonly store: Store,
    private readonly clock: ClockPort = systemClockPort,
  ) {}

  async confirm(request: ConfirmationRequest, context: SkillExecutionContext): Promise<ConfirmationDecision> {
    const inputHash = hashInput(request.input);
    const grant = context.confirmationGrant;
    // The action text is part of the grant: if what would happen now differs from what the
    // user approved (e.g. a different GitHub identity was connected meanwhile), ask again.
    if (grant && grant.skillId === request.skillId && grant.inputHash === inputHash && grant.action === request.action) {
      return { approved: true };
    }
    const now = this.clock.now();
    const record: ConfirmationRecord = {
      id: randomUUID(),
      accountId: context.accountId,
      skillId: request.skillId,
      input: request.input,
      inputHash,
      action: request.action,
      riskLevel: request.riskLevel,
      actionClass: request.actionClass,
      conversationId: context.conversationId,
      ...(context.taskId ? { taskId: context.taskId } : {}),
      status: "PENDING",
      createdAt: now,
      expiresAt: new Date(now.getTime() + CONFIRMATION_TTL_MS),
    };
    await this.store.createConfirmation(record);
    return { approved: false, pending: toView(record, request.skillName) };
  }

  /** Consumes a pending confirmation. Returns the grant + the exact call to execute, or undefined. */
  async approve(accountId: string, confirmationId: string): Promise<{ record: ConfirmationRecord; grant: ConfirmationGrant } | undefined> {
    const record = await this.store.resolveConfirmation(accountId, confirmationId, "APPROVED", this.clock.now());
    if (!record) return undefined;
    // Defense in depth: the stored hash must still match the stored input.
    if (hashInput(record.input) !== record.inputHash) return undefined;
    return { record, grant: { confirmationId: record.id, skillId: record.skillId, inputHash: record.inputHash, action: record.action } };
  }

  async decline(accountId: string, confirmationId: string): Promise<ConfirmationRecord | undefined> {
    return this.store.resolveConfirmation(accountId, confirmationId, "DECLINED", this.clock.now());
  }

  async get(accountId: string, confirmationId: string): Promise<ConfirmationRecord | undefined> {
    return this.store.getConfirmation(accountId, confirmationId);
  }
}

export function toView(record: ConfirmationRecord, skillName: string): PendingConfirmationView {
  return {
    id: record.id,
    skillId: record.skillId,
    skillName,
    action: record.action,
    riskLevel: record.riskLevel,
    actionClass: record.actionClass,
    expiresAt: record.expiresAt.toISOString(),
  };
}
