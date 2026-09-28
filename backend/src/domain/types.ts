/**
 * Server-side mirror of android/domain's entity shapes (see ARCHITECTURE.md
 * "Backend/Android parity note"). Both sides implement the same rule shapes so the
 * backend's Tool pipeline is the authoritative security boundary regardless of what a
 * client believes. See MASTER_SPEC.md §6, §7, §19.
 */

export type PermissionType =
  | "NOTIFICATIONS"
  | "CONTACTS"
  | "PHONE_CALL"
  | "CAMERA"
  | "MICROPHONE"
  | "STORAGE"
  | "CALENDAR"
  | "LOCATION";

/** Blueprint §10 risk classes. VERY_HIGH is reserved for security-sensitive capabilities. */
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

/** Blueprint §17 action classes — see capabilities/registry.ts `policyRequiresConfirmation`. */
export type { ActionClass } from "../capabilities/registry.js";
import type { ActionClass } from "../capabilities/registry.js";

export type EntitlementLevel = "FREE" | "TRIAL" | "PLUS" | "PRO" | "BUSINESS" | "ENTERPRISE";

export type SkillCategory =
  | "PERSONAL"
  | "PHONE"
  | "WEB"
  | "DOCUMENTS"
  | "PRODUCTIVITY"
  | "BUSINESS"
  | "RESEARCH"
  | "CREATIVE"
  | "EDUCATION"
  | "SEO"
  | "DEVELOPER"
  | "GITHUB"
  | "AUTOMATION";

export interface UsageCost {
  value: number;
  unit: string;
}

export const FREE_USAGE: UsageCost = { value: 0, unit: "credits" };

/** Deliberately minimal — see android/domain's JsonSchema.kt for the same design note. */
export interface JsonSchema {
  requiredFields: string[];
  properties?: Record<string, string>;
}

export interface SkillInput {
  values: Record<string, unknown>;
}

export interface SkillExecutionContext {
  accountId: string;
  taskId?: string;
  /** Conversation the call belongs to, so a later approval can report back into it. */
  conversationId?: string;
  locale?: string;
  /**
   * Set ONLY by the confirmations route after it atomically consumed a server-issued,
   * account-bound, single-use confirmation. The pipeline re-checks that the grant matches
   * this exact skill and input before executing. A client can never set this directly.
   */
  confirmationGrant?: ConfirmationGrant;
}

export interface ConfirmationGrant {
  confirmationId: string;
  skillId: string;
  inputHash: string;
}

export type SkillResult =
  | { kind: "success"; output: Record<string, unknown>; summary: string }
  | { kind: "failure"; reason: string; userMessage: string };

export type PreparedAction =
  | { kind: "ready"; description: string }
  | { kind: "failed"; failure: Extract<SkillResult, { kind: "failure" }> };

export type SkillHandler = (input: SkillInput, context: SkillExecutionContext) => Promise<SkillResult>;

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  capabilities: string[];
  requiredPermissions: PermissionType[];
  requiredEntitlement: EntitlementLevel;
  usageCost: UsageCost;
  riskLevel: RiskLevel;
  /** Blueprint §17 action class; drives the confirmation policy together with riskLevel. */
  actionClass: ActionClass;
  /** Phase 1 capability this skill uses, when it touches a device/platform capability. */
  capabilityId?: string;
  requiresConfirmation: boolean;
  executesOnDevice: boolean;
  inputSchema: JsonSchema;
  /** Human-readable description of exactly what this call will do, shown in confirmations. */
  describeAction?: (input: SkillInput) => string;
  /**
   * Optional pre-confirmation check (mirrors Android's SkillPreparer): verifies preconditions
   * (e.g. the user's GitHub identity can push) and returns the exact action to confirm, so a
   * user is never asked to approve something that cannot run or is described inaccurately.
   */
  prepare?: (input: SkillInput, context: SkillExecutionContext) => Promise<PreparedAction>;
  handler: SkillHandler;
}

export function assertValidSkillId(id: string): void {
  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(id)) {
    throw new Error(`Skill id must be 'category.action' lowercase (e.g. 'web.search'), got: '${id}'`);
  }
}

export interface ToolCall {
  id: string;
  skillId: string;
  input: SkillInput;
}

export type EntitlementDenialReason = "TRIAL_EXPIRED" | "PLAN_TOO_LOW" | "OUT_OF_CREDITS";

export type EntitlementDecision =
  | { allowed: true }
  | { allowed: false; reason: EntitlementDenialReason; upgradeTo?: EntitlementLevel };

export interface AccountEntitlementSnapshot {
  accountId: string;
  plan: EntitlementLevel;
  trialExpiresAt: Date | null;
  creditBalance: number;
}

export type ToolExecutionOutcome =
  | { kind: "success"; result: Extract<SkillResult, { kind: "success" }>; chargedCredits: number }
  | { kind: "skill_not_found"; skillId: string }
  | { kind: "validation_failed"; missingFields: string[] }
  | { kind: "permission_denied"; missing: PermissionType[] }
  | { kind: "entitlement_denied"; decision: Extract<EntitlementDecision, { allowed: false }> }
  | { kind: "confirmation_required"; confirmation: PendingConfirmationView }
  | { kind: "confirmation_declined"; skillId: string }
  | { kind: "execution_failed"; result: Extract<SkillResult, { kind: "failure" }> }
  | { kind: "verification_failed"; skillId: string; reason: string };

export interface PendingConfirmationView {
  id: string;
  skillId: string;
  skillName: string;
  /** Exactly what will happen if approved (skill.describeAction or a bounded input summary). */
  action: string;
  riskLevel: RiskLevel;
  actionClass: ActionClass;
  expiresAt: string;
}

export type TaskStatus = "PENDING" | "RUNNING" | "PAUSED" | "DONE" | "FAILED" | "CANCELLED";
export type StepStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";

export interface TaskStep {
  id: string;
  description: string;
  skillId?: string;
  status: StepStatus;
  resultSummary?: string;
  retryCount: number;
}

export interface Task {
  id: string;
  accountId: string;
  goal: string;
  status: TaskStatus;
  steps: TaskStep[];
  riskLevel: RiskLevel;
  createdAt: Date;
}
