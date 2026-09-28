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
data class AuthTokensResponse(
    val accessToken: String,
    val refreshToken: String,
    val accountId: String,
    val isGuest: Boolean = true,
    val email: String? = null,
)

@Serializable
data class IdentityResponse(val accountId: String, val isGuest: Boolean, val email: String? = null)

/** Error body shape for auth failures: `code` distinguishes "session gone" from other errors. */
@Serializable
data class ApiErrorResponse(val error: String? = null, val code: String? = null)

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

/** No "confirmed" field: higher-risk actions come back as server-issued confirmations. */
@Serializable
data class OrchestratorTurnRequest(
    val utterance: String,
    val locale: String? = null,
    val conversationId: String? = null,
)

@Serializable
data class OrchestratorTurnResponse(
    val message: String,
    val toolCalls: List<ToolCallResultDto> = emptyList(),
    val conversationId: String? = null,
)

@Serializable
data class ToolCallResultDto(val skillId: String, val outcome: OutcomeDto, val result: StructuredResultDto? = null)

/** Only the fields the client needs to render are modeled — the full outcome shape lives server-side. */
@Serializable
data class OutcomeDto(val kind: String, val confirmation: PendingConfirmationDto? = null)

/** A server-issued, single-use confirmation for one exact action. */
@Serializable
data class PendingConfirmationDto(
    val id: String,
    val skillId: String,
    val skillName: String,
    val action: String,
    val riskLevel: String,
    val actionClass: String,
    val expiresAt: String,
)

/** Blueprint §10 structured tool result, as returned by the backend. */
@Serializable
data class StructuredResultDto(
    val success: Boolean,
    val status: String,
    val capabilityId: String? = null,
    val skillId: String,
    val userSafeMessage: String,
    val retryable: Boolean = false,
)

@Serializable
data class ConfirmationResolutionResponse(
    val confirmationId: String,
    val message: String,
    val result: StructuredResultDto,
)

@Serializable
data class ConversationMessageDto(val id: String, val role: String, val content: String, val createdAt: String)

@Serializable
data class ConversationMessagesResponse(
    val conversationId: String,
    val title: String? = null,
    val messages: List<ConversationMessageDto> = emptyList(),
)

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

@Serializable
data class TtsSynthesizeRequest(val text: String, val voice: String? = null)

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
