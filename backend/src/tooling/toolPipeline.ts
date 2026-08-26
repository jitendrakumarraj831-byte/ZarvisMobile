import { resolveEntitlement } from "../domain/entitlementResolver.js";
import type { PermissionType, SkillExecutionContext, ToolCall, ToolExecutionOutcome } from "../domain/types.js";
import type { ClockPort, ConfirmationPort, EntitlementPort, PermissionPort, UsagePort } from "./ports.js";
import { systemClockPort } from "./ports.js";
import type { SkillRegistry } from "./skillRegistry.js";

/**
 * The mandatory security boundary described in MASTER_SPEC.md §7 and SECURITY.md —
 * mirrors android/domain/tooling/ToolPipeline.kt stage-for-stage. No skill handler is ever
 * invoked except through this pipeline, and no stage can be skipped by a caller. This is
 * the backend's *authoritative* enforcement — the Android pipeline exists for responsive
 * UX only (see ARCHITECTURE.md "Backend/Android parity note").
 *
 * Registry -> Validation -> Permission -> Entitlement -> Confirmation -> Execution -> Verification
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

    // 2. Validation
    const providedKeys = new Set(Object.keys(call.input.values));
    const missingFields = skill.inputSchema.requiredFields.filter((field) => !providedKeys.has(field));
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

    // 5. Confirmation (MEDIUM/HIGH risk — ambiguous conversation never counts as consent)
    if (skill.requiresConfirmation) {
      const approved = await this.confirmationPort.confirm(
        { skillId: skill.id, summary: skill.description, riskLevel: skill.riskLevel },
        context,
      );
      if (!approved) {
        return { kind: "confirmation_declined", skillId: skill.id };
      }
    }

    // 6. Execution
    const result = await skill.handler(call.input, context);
    if (result.kind === "failure") {
      return { kind: "execution_failed", result };
    }

    // 7. Verification — never report success on an empty/absent result
    if (result.summary.trim().length === 0) {
      return { kind: "verification_failed", skillId: skill.id, reason: "Skill reported success with no result summary" };
    }

    // Charge only after a verified success — a blocked/failed action is never charged.
    let chargedCredits = 0;
    if (skill.usageCost.value > 0) {
      await this.usagePort.charge(context.accountId, skill.usageCost, skill.id);
      chargedCredits = skill.usageCost.value;
    }

    return { kind: "success", result, chargedCredits };
  }
}
