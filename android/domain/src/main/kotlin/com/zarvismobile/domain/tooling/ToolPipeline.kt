package com.zarvismobile.domain.tooling

import com.zarvismobile.domain.entitlement.EntitlementResolver
import com.zarvismobile.domain.entity.ConfirmationRequest
import com.zarvismobile.domain.entity.EntitlementDecision
import com.zarvismobile.domain.entity.SkillExecutionContext
import com.zarvismobile.domain.entity.SkillResult
import com.zarvismobile.domain.entity.ToolCall
import com.zarvismobile.domain.entity.ToolExecutionOutcome
import com.zarvismobile.domain.port.ClockPort
import com.zarvismobile.domain.port.ConfirmationPort
import com.zarvismobile.domain.port.EntitlementPort
import com.zarvismobile.domain.port.PermissionPort
import com.zarvismobile.domain.port.SystemClockPort
import com.zarvismobile.domain.port.UsagePort

/**
 * The mandatory security boundary described in MASTER_SPEC.md §7: no skill handler is ever
 * invoked except through this pipeline, and no stage can be skipped by a caller.
 *
 * Registry -> Validation -> Permission -> Entitlement -> Confirmation -> Execution -> Verification
 */
class ToolPipeline(
    private val registry: SkillRegistry,
    private val permissionPort: PermissionPort,
    private val entitlementPort: EntitlementPort,
    private val usagePort: UsagePort,
    private val confirmationPort: ConfirmationPort,
    private val clock: ClockPort = SystemClockPort,
) {
    suspend fun execute(call: ToolCall, context: SkillExecutionContext): ToolExecutionOutcome {
        // 1. Tool Registry
        val skill = registry.find(call.skillId)
            ?: return ToolExecutionOutcome.SkillNotFound(call.skillId)

        // 2. Validation
        val missingFields = skill.inputSchema.requiredFields - call.input.values.keys
        if (missingFields.isNotEmpty()) {
            return ToolExecutionOutcome.ValidationFailed(missingFields)
        }

        // 3. Permission
        val missingPermissions = skill.requiredPermissions.filterNot { permissionPort.isGranted(it) }
        if (missingPermissions.isNotEmpty()) {
            return ToolExecutionOutcome.PermissionDenied(missingPermissions)
        }

        // 4. Entitlement (also covers the Risk/credit check for usage-costed skills)
        val snapshot = entitlementPort.snapshot(context.accountId)
        val decision = EntitlementResolver.resolve(snapshot, skill, clock.now())
        if (decision is EntitlementDecision.Denied) {
            return ToolExecutionOutcome.EntitlementDenied(decision)
        }

        // 5. Confirmation (MEDIUM/HIGH risk — ambiguous conversation never counts as consent)
        if (skill.requiresConfirmation) {
            val approved = confirmationPort.confirm(
                ConfirmationRequest(skillId = skill.id, summary = skill.description, riskLevel = skill.riskLevel),
            )
            if (!approved) {
                return ToolExecutionOutcome.ConfirmationDeclined(skill.id)
            }
        }

        // 6. Execution
        val result = skill.handler.execute(call.input, context)
        if (result is SkillResult.Failure) {
            return ToolExecutionOutcome.ExecutionFailed(result)
        }
        check(result is SkillResult.Success)

        // 7. Verification — never report success on an empty/absent result
        if (result.summary.isBlank()) {
            return ToolExecutionOutcome.VerificationFailed(
                skillId = skill.id,
                reason = "Skill reported success with no result summary",
            )
        }

        // Charge only after a verified success — a blocked/failed action is never charged.
        val chargedCredits = if (skill.usageCost.value > 0) {
            usagePort.charge(context.accountId, skill.usageCost, skill.id)
            skill.usageCost.value
        } else {
            0
        }

        return ToolExecutionOutcome.Success(result, chargedCredits)
    }
}
