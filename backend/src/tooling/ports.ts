import type {
  AccountEntitlementSnapshot,
  ActionClass,
  PendingConfirmationView,
  PermissionType,
  RiskLevel,
  SkillExecutionContext,
  UsageCost,
} from "../domain/types.js";

/**
 * Platform seams the ToolPipeline is built against, mirroring android/domain/port/Ports.kt.
 * See ARCHITECTURE.md "Why a pure-Kotlin domain module" — the same reasoning applies here:
 * these interfaces keep the pipeline testable without a real database or auth provider.
 */
export interface PermissionPort {
  isGranted(accountId: string, permission: PermissionType): Promise<boolean>;
}

export interface EntitlementPort {
  snapshot(accountId: string): Promise<AccountEntitlementSnapshot>;
}

export interface UsagePort {
  /** Deducts `cost` for `skillId` and returns the account's new credit balance. */
  charge(accountId: string, cost: UsageCost, skillId: string): Promise<number>;
}

export interface ConfirmationRequest {
  skillId: string;
  skillName: string;
  /** Exactly what this call will do — the user confirms this text, not a generic description. */
  action: string;
  riskLevel: RiskLevel;
  actionClass: ActionClass;
  /** The exact validated input; an approval is bound to its hash. */
  input: Record<string, unknown>;
}

export type ConfirmationDecision =
  | { approved: true }
  | { approved: false; pending: PendingConfirmationView };

/**
 * Decides whether one specific call may run. The server implementation
 * (security/confirmationService.ts) approves only a call carrying a grant that was consumed
 * from a server-issued, account-bound, single-use, expiring confirmation for this exact skill
 * and input; everything else gets a new pending confirmation back.
 */
export interface ConfirmationPort {
  confirm(request: ConfirmationRequest, context: SkillExecutionContext): Promise<ConfirmationDecision>;
}

export interface ClockPort {
  now(): Date;
}

export const systemClockPort: ClockPort = { now: () => new Date() };
