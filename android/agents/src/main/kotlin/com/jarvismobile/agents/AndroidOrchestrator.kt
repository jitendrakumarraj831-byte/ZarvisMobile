package com.jarvismobile.agents

import com.jarvismobile.data.remote.JarvisApi
import com.jarvismobile.data.remote.dto.OrchestratorTurnRequest
import com.jarvismobile.domain.entity.SkillExecutionContext
import com.jarvismobile.domain.entity.SkillInput
import com.jarvismobile.domain.entity.ToolCall
import com.jarvismobile.domain.entity.ToolExecutionOutcome
import com.jarvismobile.domain.orchestrator.KeywordSkillMatcher
import com.jarvismobile.domain.tooling.SkillRegistry
import com.jarvismobile.domain.tooling.ToolPipeline

/**
 * The Android half of the request lifecycle described in ARCHITECTURE.md: try an on-device
 * skill first (fast, works offline for skills like `personal.reminder`); otherwise delegate
 * to the backend Orchestrator, which runs its own AI-driven tool-calling loop against the
 * entitlement-filtered backend skill catalogue (AI_ARCHITECTURE.md).
 *
 * On-device confirmation (MEDIUM/HIGH risk) is fully wired: `onDevicePipeline` blocks on
 * [com.jarvismobile.core.tooling.ComposeConfirmationPort], which the app's root composable
 * renders as a dialog (see `app/MainActivity.kt`). Backend-side confirmation is not yet
 * looped back through this client — `runTurn` never resubmits with `confirmed = true` after
 * a `confirmation_declined` outcome — because every currently-registered backend skill is
 * LOW risk (SKILLS.md), so the path is unreachable today. This is planned, not implemented,
 * for whenever the first MEDIUM/HIGH risk backend skill ships (MASTER_SPEC.md §29).
 */
class AndroidOrchestrator(
    private val onDeviceRegistry: SkillRegistry,
    private val onDevicePipeline: ToolPipeline,
    private val api: JarvisApi,
) {
    private val onDeviceMatcher = KeywordSkillMatcher(onDeviceRegistry)

    suspend fun handleTurn(utterance: String, accountId: String, locale: String = "en"): TurnOutcome {
        val onDeviceSkill = onDeviceMatcher.match(utterance)
        if (onDeviceSkill != null) {
            val input = SkillInput(values = mapOf("action" to "create", "title" to utterance))
            val outcome = onDevicePipeline.execute(
                ToolCall(skillId = onDeviceSkill.id, input = input),
                SkillExecutionContext(accountId = accountId, locale = locale),
            )
            return TurnOutcome.fromOnDevice(outcome)
        }

        val response = api.runTurn(OrchestratorTurnRequest(utterance = utterance, locale = locale))
        return TurnOutcome(message = response.message)
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
        com.jarvismobile.domain.entity.EntitlementDenialReason.TRIAL_EXPIRED ->
            "Your trial has ended — upgrade to ${upgradeTo ?: "a paid plan"} to keep using this."
        com.jarvismobile.domain.entity.EntitlementDenialReason.PLAN_TOO_LOW ->
            "This needs the ${upgradeTo ?: "next"} plan."
        com.jarvismobile.domain.entity.EntitlementDenialReason.OUT_OF_CREDITS ->
            "You're out of credits for this action right now."
    }
}
