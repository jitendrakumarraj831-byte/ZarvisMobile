package com.zarvismobile.domain.entity

import java.util.UUID

/** One requested invocation of a skill, as decided by the Orchestrator/planner. */
data class ToolCall(
    val id: String = UUID.randomUUID().toString(),
    val skillId: String,
    val input: SkillInput,
)

/** Shown to the user for MEDIUM/HIGH risk skills before execution. See MASTER_SPEC.md §7. */
data class ConfirmationRequest(
    val skillId: String,
    val summary: String,
    val riskLevel: RiskLevel,
)

/**
 * The result of running a [ToolCall] through the full pipeline (registry -> validation ->
 * permission -> entitlement -> confirmation -> execution -> verification). Every stage that
 * can stop execution has its own outcome so callers can explain *why* to the user instead of
 * a generic failure. See MASTER_SPEC.md §7 and SECURITY.md.
 */
sealed interface ToolExecutionOutcome {
    data class Success(val result: SkillResult.Success, val chargedCredits: Int) : ToolExecutionOutcome
    data class SkillNotFound(val skillId: String) : ToolExecutionOutcome
    data class ValidationFailed(val missingFields: Set<String>) : ToolExecutionOutcome
    data class PermissionDenied(val missing: List<PermissionType>) : ToolExecutionOutcome
    data class EntitlementDenied(val decision: EntitlementDecision.Denied) : ToolExecutionOutcome
    data class ConfirmationDeclined(val skillId: String) : ToolExecutionOutcome
    data class ExecutionFailed(val result: SkillResult.Failure) : ToolExecutionOutcome
    data class VerificationFailed(val skillId: String, val reason: String) : ToolExecutionOutcome
}
