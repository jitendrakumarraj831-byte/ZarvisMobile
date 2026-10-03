package com.zarvismobile.domain.tooling

import com.zarvismobile.domain.capability.ActionPolicy
import com.zarvismobile.domain.entitlement.EntitlementResolver
import com.zarvismobile.domain.entity.ConfirmationRequest
import com.zarvismobile.domain.entity.EntitlementDecision
import com.zarvismobile.domain.entity.EntitlementLevel
import com.zarvismobile.domain.entity.PreparedAction
import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.SkillExecutionContext
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.entity.SkillResult
import com.zarvismobile.domain.entity.ToolCall
import com.zarvismobile.domain.entity.ToolExecutionOutcome
import com.zarvismobile.domain.port.ClockPort
import com.zarvismobile.domain.port.ConfirmationPort
import com.zarvismobile.domain.port.EntitlementPort
import com.zarvismobile.domain.port.PermissionPort
import com.zarvismobile.domain.port.SystemClockPort
import com.zarvismobile.domain.port.UsagePort
import kotlin.coroutines.cancellation.CancellationException

/**
 * The mandatory on-device security boundary — mirrors backend/src/tooling/toolPipeline.ts.
 * No skill handler is ever invoked except through this pipeline, and no stage can be skipped.
 *
 * Registry -> Validation -> Permission (live Android state) -> Entitlement -> Prepare ->
 * Policy/Confirmation (exact action) -> Execution -> Verification -> Charge
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

        // 2. Validation — present and non-blank
        val missingFields = skill.inputSchema.requiredFields.filter { field ->
            val value = call.input.values[field]
            value == null || (value is String && value.isBlank())
        }.toSet()
        if (missingFields.isNotEmpty()) {
            return ToolExecutionOutcome.ValidationFailed(missingFields)
        }

        // 3. Permission — PermissionPort reads Android's live state, re-checked at execution time.
        val missingPermissions = skill.requiredPermissions.filterNot { permissionPort.isGranted(it) }
        if (missingPermissions.isNotEmpty()) {
            return ToolExecutionOutcome.PermissionDenied(missingPermissions)
        }

        // 4. Entitlement. A FREE, zero-cost skill is allowed for every plan and balance, so it
        // needs no network round trip (device actions keep working offline); anything else
        // asks the server-authoritative snapshot.
        if (!isFreeForEveryone(skill)) {
            val snapshot = entitlementPort.snapshot(context.accountId)
            val decision = EntitlementResolver.resolve(snapshot, skill, clock.now())
            if (decision is EntitlementDecision.Denied) {
                return ToolExecutionOutcome.EntitlementDenied(decision)
            }
        }

        // 5. Prepare — resolve exactly what will happen (e.g. contact → number) before confirming.
        var input: SkillInput = call.input
        var actionDescription = skill.description
        skill.preparer?.let { preparer ->
            when (val prepared = safely(skill) { preparer.prepare(call.input, context) }) {
                is PreparedAction.Ready -> {
                    input = prepared.input
                    actionDescription = prepared.description
                }
                is PreparedAction.Failed -> return ToolExecutionOutcome.ExecutionFailed(prepared.failure)
                null -> return ToolExecutionOutcome.ExecutionFailed(handlerError(skill))
            }
        }

        // 6. Policy + confirmation of the exact action. The policy can only add a requirement.
        if (ActionPolicy.requiresConfirmation(skill)) {
            val approved = confirmationPort.confirm(
                ConfirmationRequest(
                    skillId = skill.id,
                    summary = actionDescription,
                    riskLevel = skill.riskLevel,
                    actionClass = skill.actionClass,
                    capabilityId = skill.capabilityId,
                ),
            )
            if (!approved) {
                return ToolExecutionOutcome.ConfirmationDeclined(skill.id)
            }
            // Permission can be revoked while the dialog is open — re-check right before acting.
            val revoked = skill.requiredPermissions.filterNot { permissionPort.isGranted(it) }
            if (revoked.isNotEmpty()) {
                return ToolExecutionOutcome.PermissionDenied(revoked)
            }
        }

        // 7. Execution — a thrown platform error is an honest failure, never a crash.
        val result = safely(skill) { skill.handler.execute(input, context) } ?: handlerError(skill)
        if (result is SkillResult.Failure) {
            return ToolExecutionOutcome.ExecutionFailed(result)
        }
        check(result is SkillResult.Success)

        // 8. Verification — never report success on an empty/absent result
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

    private fun isFreeForEveryone(skill: SkillDefinition): Boolean =
        skill.requiredEntitlement == EntitlementLevel.FREE && skill.usageCost.value == 0

    private inline fun <T> safely(skill: SkillDefinition, block: () -> T): T? = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    private fun handlerError(skill: SkillDefinition) = SkillResult.Failure(
        reason = "handler_error",
        userMessage = "${skill.name} ran into an error, so nothing was completed. Please try again.",
    )
}
