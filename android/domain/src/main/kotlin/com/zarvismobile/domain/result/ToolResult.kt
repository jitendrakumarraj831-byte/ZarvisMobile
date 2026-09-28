package com.zarvismobile.domain.result

import com.zarvismobile.domain.entity.EntitlementDenialReason
import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.ToolExecutionOutcome
import com.zarvismobile.domain.entity.ToolResultStatus

/**
 * Blueprint §10 structured tool result — what every Android tool returns. `verificationEvidence`
 * holds only what the platform actually reported (e.g. the dialer accepted ACTION_CALL, the
 * picker returned a URI); it is null whenever nothing was verified.
 */
data class ToolResult(
    val success: Boolean,
    val status: ToolResultStatus,
    val capabilityId: String?,
    val skillId: String,
    val userSafeMessage: String,
    val retryable: Boolean,
    val verificationEvidence: Map<String, String>?,
)

object ToolResults {

    fun from(skillId: String, skill: SkillDefinition?, outcome: ToolExecutionOutcome): ToolResult {
        val capabilityId = skill?.capabilityId
        val message = explain(outcome)
        return when (outcome) {
            is ToolExecutionOutcome.Success -> ToolResult(
                success = true,
                status = if (outcome.result.userActionRequired) ToolResultStatus.USER_ACTION_REQUIRED else ToolResultStatus.COMPLETED,
                capabilityId = capabilityId,
                skillId = skillId,
                userSafeMessage = message,
                retryable = false,
                verificationEvidence = outcome.result.evidence.ifEmpty { null },
            )
            is ToolExecutionOutcome.PermissionDenied ->
                ToolResult(false, ToolResultStatus.PERMISSION_REQUIRED, capabilityId, skillId, message, true, null)
            is ToolExecutionOutcome.ConfirmationDeclined ->
                ToolResult(false, ToolResultStatus.DENIED, capabilityId, skillId, message, false, null)
            is ToolExecutionOutcome.EntitlementDenied ->
                ToolResult(false, ToolResultStatus.DENIED, capabilityId, skillId, message, false, null)
            is ToolExecutionOutcome.SkillNotFound ->
                ToolResult(false, ToolResultStatus.UNSUPPORTED, capabilityId, skillId, message, false, null)
            is ToolExecutionOutcome.ValidationFailed ->
                ToolResult(false, ToolResultStatus.USER_ACTION_REQUIRED, capabilityId, skillId, message, true, null)
            is ToolExecutionOutcome.ExecutionFailed -> ToolResult(
                success = false,
                status = if (outcome.result.userActionRequired) ToolResultStatus.USER_ACTION_REQUIRED else ToolResultStatus.FAILED,
                capabilityId = capabilityId,
                skillId = skillId,
                userSafeMessage = message,
                retryable = true,
                verificationEvidence = null,
            )
            is ToolExecutionOutcome.VerificationFailed ->
                ToolResult(false, ToolResultStatus.FAILED, capabilityId, skillId, message, true, null)
        }
    }

    /** Mirrors backend/src/agents/orchestrator.ts explainOutcome — never a fake success. */
    fun explain(outcome: ToolExecutionOutcome): String = when (outcome) {
        is ToolExecutionOutcome.Success -> outcome.result.summary
        is ToolExecutionOutcome.SkillNotFound -> "I don't have a skill for that yet."
        is ToolExecutionOutcome.ValidationFailed ->
            "I'm missing some details before I can do that: ${outcome.missingFields.joinToString(", ")}."
        is ToolExecutionOutcome.PermissionDenied ->
            "This needs a permission that isn't granted: ${outcome.missing.joinToString(", ") { it.name.lowercase().replace('_', ' ') }}."
        is ToolExecutionOutcome.EntitlementDenied -> when (outcome.decision.reason) {
            EntitlementDenialReason.TRIAL_EXPIRED ->
                "Your trial has ended — upgrade to ${outcome.decision.upgradeTo ?: "a paid plan"} to keep using this."
            EntitlementDenialReason.PLAN_TOO_LOW -> "This needs the ${outcome.decision.upgradeTo ?: "next"} plan."
            EntitlementDenialReason.OUT_OF_CREDITS -> "You're out of credits for this action right now."
        }
        is ToolExecutionOutcome.ConfirmationDeclined -> "You didn't confirm, so nothing was done."
        is ToolExecutionOutcome.ExecutionFailed -> outcome.result.userMessage
        is ToolExecutionOutcome.VerificationFailed ->
            "Something went wrong while I was verifying the result, so I did not complete this action."
    }
}
