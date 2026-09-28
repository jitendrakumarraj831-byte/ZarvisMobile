import type { SkillDefinition, ToolExecutionOutcome } from "../domain/types.js";

/** Blueprint §10 structured tool result statuses. */
export type ToolResultStatus =
  | "COMPLETED"
  | "DENIED"
  | "PERMISSION_REQUIRED"
  | "USER_ACTION_REQUIRED"
  | "CONFIRMATION_REQUIRED"
  | "UNSUPPORTED"
  | "FAILED";

/**
 * Blueprint §10 structured tool result. `verificationEvidence` only ever contains facts the
 * pipeline actually observed (e.g. the skill's own output keys, the credits charged) — never
 * an assertion that something happened in the outside world beyond what the tool returned.
 */
export interface StructuredToolResult {
  success: boolean;
  status: ToolResultStatus;
  capabilityId: string | null;
  skillId: string;
  userSafeMessage: string;
  retryable: boolean;
  verificationEvidence: Record<string, unknown> | null;
}

export function toStructuredResult(
  skillId: string,
  skill: SkillDefinition | undefined,
  outcome: ToolExecutionOutcome,
  userSafeMessage: string,
): StructuredToolResult {
  const base = { skillId, capabilityId: skill?.capabilityId ?? null, userSafeMessage };
  switch (outcome.kind) {
    case "success":
      return {
        ...base,
        success: true,
        status: "COMPLETED",
        retryable: false,
        verificationEvidence: {
          check: "non_empty_result",
          outputKeys: Object.keys(outcome.result.output),
          chargedCredits: outcome.chargedCredits,
        },
      };
    case "confirmation_required":
      return { ...base, success: false, status: "CONFIRMATION_REQUIRED", retryable: false, verificationEvidence: null };
    case "confirmation_declined":
      return { ...base, success: false, status: "DENIED", retryable: false, verificationEvidence: null };
    case "permission_denied":
      return { ...base, success: false, status: "PERMISSION_REQUIRED", retryable: true, verificationEvidence: null };
    case "entitlement_denied":
      return { ...base, success: false, status: "DENIED", retryable: false, verificationEvidence: null };
    case "skill_not_found":
      return { ...base, success: false, status: "UNSUPPORTED", retryable: false, verificationEvidence: null };
    case "validation_failed":
      return { ...base, success: false, status: "USER_ACTION_REQUIRED", retryable: true, verificationEvidence: null };
    case "execution_failed":
      return { ...base, success: false, status: "FAILED", retryable: true, verificationEvidence: null };
    case "verification_failed":
      return { ...base, success: false, status: "FAILED", retryable: true, verificationEvidence: null };
  }
}
