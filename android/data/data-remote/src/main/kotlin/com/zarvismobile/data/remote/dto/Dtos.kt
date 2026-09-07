package com.zarvismobile.data.remote.dto

import kotlinx.serialization.Serializable

/** Wire-format DTOs matching backend/src/api routes — see MASTER_SPEC.md §25. */

@Serializable
data class SignupRequest(val email: String, val password: String)

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class AuthTokensResponse(val accessToken: String, val refreshToken: String, val accountId: String)

@Serializable
data class SkillDto(
    val id: String,
    val name: String,
    val description: String,
    val category: String,
    val riskLevel: String,
    val usageCost: UsageCostDto,
    val requiredEntitlement: String,
    val executesOnDevice: Boolean,
    val upgradeRequired: Boolean,
)

@Serializable
data class UsageCostDto(val value: Int, val unit: String)

@Serializable
data class SkillsResponse(val skills: List<SkillDto>)

@Serializable
data class EntitlementSnapshotResponse(
    val accountId: String,
    val plan: String,
    val trialExpiresAt: String?,
    val creditBalance: Int,
)

@Serializable
data class OrchestratorTurnRequest(
    val utterance: String,
    val confirmed: Boolean? = null,
    val locale: String? = null,
)

@Serializable
data class OrchestratorTurnResponse(
    val message: String,
    val toolCalls: List<ToolCallResultDto> = emptyList(),
)

@Serializable
data class ToolCallResultDto(val skillId: String, val outcome: OutcomeDto)

/** Only the fields the client needs to render are modeled — the full outcome shape lives server-side. */
@Serializable
data class OutcomeDto(val kind: String)

@Serializable
data class UsageChargeRequest(val skillId: String)

@Serializable
data class UsageChargeResponse(val balance: Int)

@Serializable
data class CreateTaskRequest(val goal: String)

@Serializable
data class TaskStepDto(
    val id: String,
    val description: String,
    val skillId: String? = null,
    val status: String,
    val resultSummary: String? = null,
    val retryCount: Int = 0,
)

@Serializable
data class TaskDto(
    val id: String,
    val accountId: String,
    val goal: String,
    val status: String,
    val steps: List<TaskStepDto> = emptyList(),
    val riskLevel: String,
    val createdAt: String,
)

@Serializable
data class TasksResponse(val tasks: List<TaskDto>)

@Serializable
data class DeveloperAnalyzeRequest(val repoUrl: String)

/**
 * Only the success shape is fully modeled — other [ToolExecutionOutcome] kinds (permission/
 * entitlement denial, etc.) are rendered from [kind] alone in this pass. See
 * DEVELOPER_AGENT.md for the full outcome semantics, defined authoritatively server-side.
 */
@Serializable
data class DeveloperAnalyzeResponse(
    val kind: String,
    val result: DeveloperAnalyzeResult? = null,
)

@Serializable
data class DeveloperAnalyzeResult(val summary: String, val output: DeveloperAnalyzeOutput)

@Serializable
data class DeveloperAnalyzeOutput(val structure: RepoStructureDto)

@Serializable
data class RepoStructureDto(
    val repoUrl: String,
    val primaryLanguage: String,
    val buildSystem: String,
    val hasTests: Boolean,
    val hasCi: Boolean,
    val fileCount: Int,
    val topLevelDirs: List<String>,
)
