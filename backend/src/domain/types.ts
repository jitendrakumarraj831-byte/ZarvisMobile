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
  /** Project the work belongs to (the conversation's project), recorded with the execution. */
  projectId?: string;
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
  /** The exact action text the user approved; the prepared action must still match it. */
  action: string;
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
  /** When the paid plan ends; null when the plan has no expiry. `plan` is already the effective plan. */
  planExpiresAt?: Date | null;
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

/**
 * The task status the Android client parses (its `TaskStatus` enum has exactly these values).
 * It stays on the wire for that client; the truthful state is `TaskLifecycle` below, and
 * `legacyStatus()` is the only place that maps one onto the other.
 */
export type TaskStatus = "PENDING" | "RUNNING" | "PAUSED" | "DONE" | "FAILED" | "CANCELLED";
export type StepStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";

/**
 * What a task is really doing:
 * QUEUED (recorded, nothing started) -> RUNNING (a step has started) -> EXECUTING (a tool is running)
 * -> VERIFYING (checking what the step produced) -> WAITING (a step finished, the next one needs the user
 * to start it) / CONFIRMATION_REQUIRED (an action is waiting for the user's approval) -> COMPLETED.
 * FAILED, CANCELLED and BLOCKED (cannot continue until the user fixes something) are the other ends.
 */
export type TaskLifecycle =
  | "QUEUED"
  | "RUNNING"
  | "WAITING"
  | "CONFIRMATION_REQUIRED"
  | "EXECUTING"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "BLOCKED";

export interface TaskStep {
  id: string;
  description: string;
  skillId?: string;
  status: StepStatus;
  resultSummary?: string;
  retryCount: number;
  /** Why the step failed, from the real outcome. */
  error?: string;
  startedAt?: string;
  completedAt?: string;
  /** What was actually observed when the step finished (tool statuses, verification checks). */
  evidence?: Record<string, unknown>;
}

export interface TaskEvent {
  at: string;
  type: string;
  message: string;
  stepId?: string;
}

export interface TaskFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export interface Task {
  id: string;
  accountId: string;
  goal: string;
  status: TaskStatus;
  steps: TaskStep[];
  riskLevel: RiskLevel;
  createdAt: Date;
  /** Fields below are optional so a task written before they existed still reads; see tasks/taskView.ts. */
  updatedAt?: Date;
  projectId?: string;
  /** The conversation the task's steps run in (created by the first step). */
  conversationId?: string;
  lifecycle?: TaskLifecycle;
  error?: TaskFailure;
  /** The final answer, set only when every step is done. */
  result?: { summary: string };
  events?: TaskEvent[];
  retryCount?: number;
  blockedReason?: string;
  /** The server-issued confirmation the task is waiting for. */
  pendingConfirmationId?: string;
  startedAt?: string;
  completedAt?: string;
}

const LIFECYCLE_TO_LEGACY: Record<TaskLifecycle, TaskStatus> = {
  QUEUED: "PENDING",
  RUNNING: "RUNNING",
  EXECUTING: "RUNNING",
  VERIFYING: "RUNNING",
  CONFIRMATION_REQUIRED: "RUNNING",
  WAITING: "PAUSED",
  BLOCKED: "PAUSED",
  COMPLETED: "DONE",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

export function legacyStatus(lifecycle: TaskLifecycle): TaskStatus {
  return LIFECYCLE_TO_LEGACY[lifecycle];
}

/** A task written before the lifecycle existed (or by something that only sets `status`) maps back. */
export function lifecycleFromLegacy(status: TaskStatus): TaskLifecycle {
  switch (status) {
    case "PENDING": return "QUEUED";
    case "RUNNING": return "RUNNING";
    case "PAUSED": return "WAITING";
    case "DONE": return "COMPLETED";
    case "FAILED": return "FAILED";
    case "CANCELLED": return "CANCELLED";
  }
}

/** `status` is what older code and clients set, so when it disagrees with `lifecycle` it wins. */
export function taskLifecycle(task: Pick<Task, "status" | "lifecycle">): TaskLifecycle {
  return task.lifecycle && legacyStatus(task.lifecycle) === task.status ? task.lifecycle : lifecycleFromLegacy(task.status);
}

export const TERMINAL_LIFECYCLES: readonly TaskLifecycle[] = ["COMPLETED", "FAILED", "CANCELLED"];
