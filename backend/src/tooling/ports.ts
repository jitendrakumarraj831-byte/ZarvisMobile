import type {
  AccountEntitlementSnapshot,
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
  summary: string;
  riskLevel: RiskLevel;
}

export interface ConfirmationPort {
  confirm(request: ConfirmationRequest, context: SkillExecutionContext): Promise<boolean>;
}

export interface ClockPort {
  now(): Date;
}

export const systemClockPort: ClockPort = { now: () => new Date() };
