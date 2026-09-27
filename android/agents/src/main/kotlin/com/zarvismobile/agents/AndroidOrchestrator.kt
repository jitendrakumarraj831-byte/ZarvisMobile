package com.zarvismobile.agents

import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.OrchestratorTurnRequest
import com.zarvismobile.core.tooling.ComposeConfirmationPort
import com.zarvismobile.domain.entity.ConfirmationRequest
import com.zarvismobile.domain.entity.RiskLevel
import com.zarvismobile.domain.entity.SkillExecutionContext
import com.zarvismobile.domain.entity.ToolCall
import com.zarvismobile.domain.entity.ToolExecutionOutcome
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.orchestrator.DeviceCommandGate
import com.zarvismobile.domain.orchestrator.KeywordSkillMatcher
import com.zarvismobile.domain.orchestrator.OnDeviceInputBuilder
import com.zarvismobile.domain.port.RuntimePermissionBroker
import com.zarvismobile.domain.tooling.SkillRegistry
import com.zarvismobile.domain.tooling.ToolPipeline

/**
 * The Android half of the request lifecycle. Backend high-risk actions are confirmation-gated
 * too: the server returns confirmation_declined, this client shows the same Compose dialog,
 * and only an explicit approval causes one retry with confirmed=true.
 */
class AndroidOrchestrator(
    private val onDeviceRegistry: SkillRegistry,
    private val onDevicePipeline: ToolPipeline,
    private val api: ZarvisApi,
    private val confirmationPort: ComposeConfirmationPort,
    private val permissionBroker: RuntimePermissionBroker,
) {
    private val onDeviceMatcher = KeywordSkillMatcher(onDeviceRegistry)
    private var conversationId: String? = null

    suspend fun handleTurn(utterance: String, accountId: String, locale: String = "en"): TurnOutcome {
        val onDeviceSkill = onDeviceMatcher.match(utterance)
        if (onDeviceSkill != null && DeviceCommandGate.accepts(onDeviceSkill.id, utterance)) {
            // Per-skill input shape (domain module, unit-tested) — previously hardcoded to
            // personal.reminder's {action, title} shape here regardless of which skill
            // matched, which broke silently the moment a second on-device skill (a
            // different inputSchema) was registered alongside it. See OnDeviceInputBuilder.
            val input = OnDeviceInputBuilder.build(onDeviceSkill, utterance)
            val permissions = permissionsFor(onDeviceSkill.id, input.values["target"] as? String, onDeviceSkill.requiredPermissions)
            permissionBroker.ensure(permissions)
            val outcome = onDevicePipeline.execute(
                ToolCall(skillId = onDeviceSkill.id, input = input),
                SkillExecutionContext(accountId = accountId, locale = locale),
            )
            return TurnOutcome.fromOnDevice(outcome)
        }

        val response = api.runTurn(
            OrchestratorTurnRequest(utterance = utterance, locale = locale, conversationId = conversationId),
        )
        response.conversationId?.let { conversationId = it }
        val confirmation = response.toolCalls.firstOrNull { it.outcome.kind == "confirmation_declined" }
        if (confirmation != null) {
            val approved = confirmationPort.confirm(
                ConfirmationRequest(
                    skillId = confirmation.skillId,
                    summary = "ZARVIS wants to perform a higher-risk action for your request.",
                    riskLevel = RiskLevel.HIGH,
                ),
            )
            if (approved) {
                val confirmedResponse = api.runTurn(
                    OrchestratorTurnRequest(
                        utterance = utterance,
                        confirmed = true,
                        locale = locale,
                        conversationId = conversationId,
                    ),
                )
                confirmedResponse.conversationId?.let { conversationId = it }
                return TurnOutcome(message = confirmedResponse.message)
            }
        }
        return TurnOutcome(message = response.message)
    }

    private fun permissionsFor(skillId: String, target: String?, declared: List<PermissionType>): List<PermissionType> {
        if (skillId != "phone.call") return declared
        val rawNumber = target != null && target.count { it.isDigit() } >= 7
        return if (rawNumber) listOf(PermissionType.PHONE_CALL) else listOf(PermissionType.PHONE_CALL, PermissionType.CONTACTS)
    }
}

data class TurnOutcome(val message: String) {
    companion object {
        fun fromOnDevice(outcome: ToolExecutionOutcome): TurnOutcome = TurnOutcome(message = explainOutcome(outcome))
    }
}

/** Mirrors backend/src/agents/orchestrator.ts explainOutcome — never a fake success. See MASTER_SPEC.md Product Principle #4. */
private fun explainOutcome(outcome: ToolExecutionOutcome): String = when (outcome) {
    is ToolExecutionOutcome.Success -> outcome.result.summary
    is ToolExecutionOutcome.SkillNotFound -> "I don't have a skill for that yet."
    is ToolExecutionOutcome.ValidationFailed -> "I'm missing some details before I can do that: ${outcome.missingFields.joinToString(", ")}."
    is ToolExecutionOutcome.PermissionDenied -> "This needs a permission that isn't granted yet: ${outcome.missing.joinToString(", ")}."
    is ToolExecutionOutcome.EntitlementDenied -> explainEntitlementDenial(outcome)
    is ToolExecutionOutcome.ConfirmationDeclined -> "This action needs your confirmation before I can proceed — please confirm and I'll go ahead."
    is ToolExecutionOutcome.ExecutionFailed -> outcome.result.userMessage
    is ToolExecutionOutcome.VerificationFailed -> "Something went wrong while I was verifying the result, so I did not complete this action."
}

private fun explainEntitlementDenial(outcome: ToolExecutionOutcome.EntitlementDenied): String {
    val upgradeTo = outcome.decision.upgradeTo
    return when (outcome.decision.reason) {
        com.zarvismobile.domain.entity.EntitlementDenialReason.TRIAL_EXPIRED ->
            "Your trial has ended — upgrade to ${upgradeTo ?: "a paid plan"} to keep using this."
        com.zarvismobile.domain.entity.EntitlementDenialReason.PLAN_TOO_LOW ->
            "This needs the ${upgradeTo ?: "next"} plan."
        com.zarvismobile.domain.entity.EntitlementDenialReason.OUT_OF_CREDITS ->
            "You're out of credits for this action right now."
    }
}
