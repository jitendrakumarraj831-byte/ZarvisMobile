import { policyRequiresConfirmation } from "../capabilities/registry.js";
import { resolveEntitlement } from "../domain/entitlementResolver.js";
import { InsufficientCreditsError } from "../store/store.js";
import type {
  PermissionType,
  SkillDefinition,
  SkillExecutionContext,
  SkillInput,
  SkillResult,
  ToolCall,
  ToolExecutionOutcome,
} from "../domain/types.js";
import { logger } from "../security/redact.js";
import type { ClockPort, ConfirmationPort, EntitlementPort, PermissionPort, UsagePort } from "./ports.js";
import { systemClockPort } from "./ports.js";
import type { SkillRegistry } from "./skillRegistry.js";

/**
 * A skill handler may throw this to report an expected, user-explainable failure (e.g. a
 * GitHub 404) with a safe message. Any other thrown error is reported generically.
 */
export class SkillUserError extends Error {
  constructor(
    readonly reason: string,
    readonly userMessage: string,
    readonly retryable = false,
  ) {
    super(userMessage);
    this.name = "SkillUserError";
  }
}

const MAX_ACTION_DESCRIPTION_CHARS = 600;

/**
 * The mandatory security boundary (blueprint §9): mirrors
 * android/domain/tooling/ToolPipeline.kt stage-for-stage. No skill handler is ever invoked
 * except through this pipeline, and no stage can be skipped by a caller.
 *
 * Registry -> Validation -> Permission -> Entitlement -> Policy/Confirmation -> Execution -> Verification
 */
export class ToolPipeline {
  constructor(
    private readonly registry: SkillRegistry,
    private readonly permissionPort: PermissionPort,
    private readonly entitlementPort: EntitlementPort,
    private readonly usagePort: UsagePort,
    private readonly confirmationPort: ConfirmationPort,
    private readonly clock: ClockPort = systemClockPort,
  ) {}

  async execute(call: ToolCall, context: SkillExecutionContext): Promise<ToolExecutionOutcome> {
    // 1. Tool Registry
    const skill = this.registry.find(call.skillId);
    if (!skill) {
      return { kind: "skill_not_found", skillId: call.skillId };
    }

    // 2. Validation — present AND non-blank; an empty string is not a provided value.
    const missingFields = skill.inputSchema.requiredFields.filter((field) => {
      const value = call.input.values[field];
      return value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);
    });
    if (missingFields.length > 0) {
      return { kind: "validation_failed", missingFields };
    }

    // 3. Permission
    const missingPermissions: PermissionType[] = [];
    for (const permission of skill.requiredPermissions) {
      const granted = await this.permissionPort.isGranted(context.accountId, permission);
      if (!granted) missingPermissions.push(permission);
    }
    if (missingPermissions.length > 0) {
      return { kind: "permission_denied", missing: missingPermissions };
    }

    // 4. Entitlement (also covers the credit-sufficiency check for usage-costed skills)
    const snapshot = await this.entitlementPort.snapshot(context.accountId);
    const decision = resolveEntitlement(snapshot, skill, this.clock.now());
    if (!decision.allowed) {
      return { kind: "entitlement_denied", decision };
    }

    // 5. Prepare — check preconditions and describe the exact action before any confirmation.
    let action = describeAction(skill, call.input);
    if (skill.prepare) {
      let prepared;
      try {
        prepared = await skill.prepare(call.input, context);
      } catch (err) {
        prepared = {
          kind: "failed" as const,
          failure:
            err instanceof SkillUserError
              ? { kind: "failure" as const, reason: err.reason, userMessage: err.userMessage }
              : { kind: "failure" as const, reason: "prepare_error", userMessage: `${skill.name} couldn't check its requirements, so nothing was done. Please try again.` },
        };
      }
      if (prepared.kind === "failed") return { kind: "execution_failed", result: prepared.failure };
      action = truncate(prepared.description);
    }

    // 6. Policy + confirmation. The policy can only add a requirement, never remove one.
    if (requiresConfirmation(skill)) {
      const confirmation = await this.confirmationPort.confirm(
        {
          skillId: skill.id,
          skillName: skill.name,
          action,
          riskLevel: skill.riskLevel,
          actionClass: skill.actionClass,
          input: call.input.values,
        },
        context,
      );
      if (!confirmation.approved) {
        return { kind: "confirmation_required", confirmation: confirmation.pending };
      }
    }

    // 7. Execution — a thrown error is an honest failure, never an unhandled 500 that
    // takes the whole conversation turn down with it.
    let result: SkillResult;
    try {
      result = await skill.handler(call.input, context);
    } catch (err) {
      if (err instanceof SkillUserError) {
        result = { kind: "failure", reason: err.reason, userMessage: err.userMessage };
      } else {
        logger.error("Skill handler threw", {
          skillId: skill.id,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
        });
        result = {
          kind: "failure",
          reason: "handler_error",
          userMessage: `${skill.name} ran into an error, so nothing was completed. Please try again.`,
        };
      }
    }
    if (result.kind === "failure") {
      return { kind: "execution_failed", result };
    }

    // 8. Verification — never report success on an empty/absent result
    if (result.summary.trim().length === 0) {
      return { kind: "verification_failed", skillId: skill.id, reason: "Skill reported success with no result summary" };
    }

    // Charge only after a verified success — a blocked/failed action is never charged.
    let chargedCredits = 0;
    if (skill.usageCost.value > 0) {
      try {
        await this.usagePort.charge(context.accountId, skill.usageCost, skill.id);
        chargedCredits = skill.usageCost.value;
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          return { kind: "entitlement_denied", decision: { allowed: false, reason: "OUT_OF_CREDITS" } };
        }
        throw err;
      }
    }

    return { kind: "success", result, chargedCredits };
  }
}

export function requiresConfirmation(skill: SkillDefinition): boolean {
  return skill.requiresConfirmation || policyRequiresConfirmation(skill.actionClass, skill.riskLevel);
}

/** What the user is asked to approve: the skill's own description of this exact call. */
export function describeAction(skill: SkillDefinition, input: SkillInput): string {
  const text = skill.describeAction
    ? skill.describeAction(input)
    : `${skill.name}: ` +
      Object.entries(input.values)
        .map(([key, value]) => `${key} = ${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join("; ");
  return truncate(text);
}

function truncate(text: string): string {
  return text.length > MAX_ACTION_DESCRIPTION_CHARS ? text.slice(0, MAX_ACTION_DESCRIPTION_CHARS - 1) + "…" : text;
}
