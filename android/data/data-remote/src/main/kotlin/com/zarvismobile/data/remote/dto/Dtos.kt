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
    /**
     * The phone actions (on-device skill ids) this app can run. The server may then hand one back as [OrchestratorTurnResponse.deviceAction]
     * instead of describing manual steps (backend/src/capabilities/deviceActions.ts). Omitted: the server offers none.
     */
    val deviceActions: List<String>? = null,
)

@Serializable
data class OrchestratorTurnResponse(
    val message: String,
    val toolCalls: List<ToolCallResultDto> = emptyList(),
    val conversationId: String? = null,
    /** A phone action the Brain chose for this turn. The server did not run it: the app runs it and reports the result. */
    val deviceAction: DeviceActionDto? = null,
)

/**
 * One phone action handed to the app: which on-device skill, with what input. [toolCallId] is echoed in the report. [then] is the
 * rest of a multi-step request, for the app to continue with after this step succeeds.
 */
@Serializable
data class DeviceActionDto(val toolCallId: String, val skillId: String, val input: Map<String, String> = emptyMap(), val then: String? = null)

/**
 * What happened when the app ran a [DeviceActionDto]: [status] is a ToolResultStatus name, [message] what the user was told. With
 * [continueWith] (the action's `then`), [step] (steps run so far), [deviceActions] and [locale], the server plans the next step and
 * answers it in [DeviceResultResponse.next].
 */
@Serializable
data class DeviceActionResultRequest(
    val conversationId: String,
    val toolCallId: String,
    val skillId: String,
    val status: String,
    val message: String,
    val continueWith: String? = null,
    val step: Int? = null,
    val deviceActions: List<String>? = null,
    val locale: String? = null,
)

/** [next] is the following step of a multi-step request (another device action, or the final reply); [stopped] says why there is none. */
@Serializable
data class DeviceResultResponse(
    val recorded: Boolean = false,
    val next: OrchestratorTurnResponse? = null,
    val stopped: String? = null,
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
    /** confirmation_required again when what would run changed since approval. */
    val outcome: OutcomeDto? = null,
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
    /** What the task is really doing (QUEUED, WAITING, EXECUTING, ...). Older servers do not send it; [status] still reads. */
    val lifecycle: String? = null,
)

@Serializable
data class TasksResponse(val tasks: List<TaskDto>)

/** One saved memory item (GET /api/v1/memory, backend/src/workspace/views.ts noteView). Only what the screen shows is modeled. */
@Serializable
data class MemoryNoteDto(
    val id: String,
    val projectId: String? = null,
    val kind: String = "memory",
    val content: String,
    /** A paused item stays saved but is not given to the model. */
    val enabled: Boolean = true,
    val updatedAt: String? = null,
)

@Serializable
data class MemoryProjectDto(
    val id: String,
    val name: String,
    val status: String? = null,
    val items: List<MemoryNoteDto> = emptyList(),
)

@Serializable
data class MemoryLimitsDto(val conversationMessages: Int = 0, val memoryItemsUsed: Int = 0)

/** What ZARVIS remembers: personal items, each project's items, and the limits that apply. */
@Serializable
data class MemoryOverviewResponse(
    val enabled: Boolean = true,
    val personal: List<MemoryNoteDto> = emptyList(),
    val projects: List<MemoryProjectDto> = emptyList(),
    val limits: MemoryLimitsDto = MemoryLimitsDto(),
)

@Serializable
data class MemorySettingsRequest(val enabled: Boolean)

@Serializable
data class MemorySettingsResponse(val enabled: Boolean)

@Serializable
data class MemoryForgetResponse(val removed: Int = 0)

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

/** Answer of `POST /api/v1/documents/extract`: the text read from the file (an image is described) and its kind. */
@Serializable
data class DocumentExtractResponse(val text: String? = null, val kind: String? = null)
