package com.zarvismobile.agents

import com.zarvismobile.core.tooling.ComposeConfirmationPort
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.OrchestratorTurnRequest
import com.zarvismobile.data.remote.dto.StructuredResultDto
import com.zarvismobile.domain.access.AccessCoordinator
import com.zarvismobile.domain.access.AccessResult
import com.zarvismobile.domain.access.PendingAction
import com.zarvismobile.domain.access.PendingActionRecovery
import com.zarvismobile.domain.access.PendingActionStore
import com.zarvismobile.domain.access.RecoveryDecision
import com.zarvismobile.domain.capability.ActionPolicy
import com.zarvismobile.domain.capability.CapabilityDefinition
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.entity.ActionClass
import com.zarvismobile.domain.entity.ConfirmationRequest
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.entity.RiskLevel
import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.SkillExecutionContext
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.entity.ToolCall
import com.zarvismobile.domain.entity.ToolResultStatus
import com.zarvismobile.domain.orchestrator.KeywordSkillMatcher
import com.zarvismobile.domain.orchestrator.OnDeviceInputBuilder
import com.zarvismobile.domain.port.ClockPort
import com.zarvismobile.domain.result.ToolResult
import com.zarvismobile.domain.result.ToolResults
import com.zarvismobile.domain.skill.PhoneCallSkillFactory
import com.zarvismobile.domain.tooling.SkillRegistry
import com.zarvismobile.domain.tooling.ToolPipeline
import java.util.UUID

/** Persists which server conversation this device is continuing (survives process death). */
interface ConversationIdStore {
    suspend fun get(): String?
    suspend fun set(id: String?)
}

data class TurnOutcome(val message: String, val result: ToolResult? = null)

data class RestoredMessage(val role: String, val content: String)

/** Re-issued confirmations (action changed after approval) the user is asked about per turn. */
private const val MAX_CONFIRMATION_ROUNDS = 3

/**
 * The Android half of the request lifecycle (blueprint §9):
 *
 * Device path — Intent → on-device skill (gated) → Capability → Permission Intelligence
 * (explain → Allow / Not Now / Learn More → Android system flow → verify real state) →
 * ToolPipeline (exact-action confirmation where policy requires) → structured result.
 *
 * Everything else goes to the shared ZARVIS Brain (backend orchestrator). A backend action
 * that needs confirmation comes back with a server-issued, single-use confirmation; this
 * client shows exactly that action and approves/declines *that id* — it never re-sends the
 * request with a "confirmed" flag.
 */
class AndroidOrchestrator(
    private val onDeviceRegistry: SkillRegistry,
    private val onDevicePipeline: ToolPipeline,
    private val api: ZarvisApi,
    private val confirmationPort: ComposeConfirmationPort,
    private val capabilities: CapabilityRegistry,
    private val access: AccessCoordinator,
    private val pendingActions: PendingActionStore,
    private val conversations: ConversationIdStore,
    private val clock: ClockPort,
) {
    private val matcher = KeywordSkillMatcher(onDeviceRegistry)

    suspend fun handleTurn(utterance: String, accountId: String, locale: String = "en"): TurnOutcome {
        val skill = matcher.matchCommand(utterance)
        return if (skill != null) handleOnDevice(skill, utterance, accountId, locale) else handleWithBrain(utterance, locale)
    }

    /** Called at startup: an action interrupted by process death is offered again, never auto-run. */
    suspend fun checkInterruptedAction(): RecoveryDecision {
        val decision = PendingActionRecovery.decide(pendingActions.load(), clock.now())
        if (decision is RecoveryDecision.Expired) pendingActions.clear()
        return decision
    }

    suspend fun dismissInterruptedAction() = pendingActions.clear()

    /** Loads only real, server-persisted history for the conversation this device is continuing. */
    suspend fun restoreConversation(): List<RestoredMessage> {
        val id = conversations.get() ?: return emptyList()
        return try {
            api.conversationMessages(id).messages.map { RestoredMessage(it.role, it.content) }
        } catch (e: retrofit2.HttpException) {
            if (e.code() == 404) conversations.set(null) // gone (e.g. account changed) — don't fabricate it
            emptyList()
        }
    }

    suspend fun startNewConversation() = conversations.set(null)

    private suspend fun handleOnDevice(skill: SkillDefinition, utterance: String, accountId: String, locale: String): TurnOutcome {
        val input = OnDeviceInputBuilder.build(skill, utterance)
        val capability = capabilities.find(skill.capabilityId)
        if (capability != null && !capability.implementedOnAndroid) {
            return unsupported(skill, capability)
        }
        val pending = PendingAction(
            id = UUID.randomUUID().toString(),
            utterance = utterance,
            skillId = skill.id,
            stage = PendingAction.Stage.AWAITING_PERMISSION,
            createdAt = clock.now(),
        )
        try {
            val needed = permissionsFor(skill, input)
            if (needed.isNotEmpty()) {
                pendingActions.save(pending)
                for ((cap, permissions) in groupByCapability(skill, capability, needed)) {
                    when (val result = access.ensure(cap, permissions)) {
                        AccessResult.Granted -> Unit
                        is AccessResult.Declined -> return accessProblem(skill, cap, ToolResultStatus.DENIED,
                            "You chose Not now, so I didn't use ${cap.name.lowercase()}. ${cap.fallback}")
                        is AccessResult.Denied -> return accessProblem(skill, cap, ToolResultStatus.PERMISSION_REQUIRED,
                            "${cap.name} access is still off" + (if (result.permanently) " (it can only be turned on in ${cap.settingsDestination})" else "") +
                                ", so nothing was done. ${cap.fallback}")
                        is AccessResult.Unsupported -> return unsupported(skill, cap, result.reason)
                    }
                }
            }
            if (ActionPolicy.requiresConfirmation(skill)) {
                pendingActions.save(pending.copy(stage = PendingAction.Stage.AWAITING_CONFIRMATION))
            }
            val outcome = onDevicePipeline.execute(
                ToolCall(skillId = skill.id, input = input),
                SkillExecutionContext(accountId = accountId, locale = locale),
            )
            val result = ToolResults.from(skill.id, skill, outcome)
            return TurnOutcome(message = result.userSafeMessage, result = result)
        } finally {
            pendingActions.clear()
        }
    }

    private suspend fun handleWithBrain(utterance: String, locale: String): TurnOutcome {
        val response = api.runTurn(
            OrchestratorTurnRequest(utterance = utterance, locale = locale, conversationId = conversations.get()),
        )
        response.conversationId?.let { conversations.set(it) }
        val lastResult = response.toolCalls.lastOrNull()?.result?.toDomain()
        var pending = response.toolCalls.firstNotNullOfOrNull { it.outcome.confirmation }
            ?: return TurnOutcome(message = response.message, result = lastResult)

        // If what would run changed after approval (e.g. a different GitHub identity), the
        // server issues a new confirmation naming the new action; the user decides again.
        repeat(MAX_CONFIRMATION_ROUNDS) {
            val approved = confirmationPort.confirm(
                ConfirmationRequest(
                    skillId = pending.skillId,
                    summary = pending.action,
                    riskLevel = runCatching { RiskLevel.valueOf(pending.riskLevel) }.getOrDefault(RiskLevel.HIGH),
                    actionClass = runCatching { ActionClass.valueOf(pending.actionClass) }.getOrDefault(ActionClass.SECURITY_SENSITIVE),
                ),
            )
            val resolution = try {
                if (approved) api.approveConfirmation(pending.id) else api.declineConfirmation(pending.id)
            } catch (e: retrofit2.HttpException) {
                if (e.code() == 404) {
                    return TurnOutcome(
                        message = "That confirmation expired or was already used, so nothing was run. Ask again if you still want it.",
                        result = ToolResult(false, ToolResultStatus.FAILED, null, pending.skillId, "Confirmation expired.", true, null),
                    )
                }
                throw e
            }
            pending = resolution.outcome?.confirmation
                ?: return TurnOutcome(message = resolution.message, result = resolution.result.toDomain())
        }
        return TurnOutcome(
            message = "The action kept changing before it could run, so nothing was done. Please ask again.",
            result = ToolResult(false, ToolResultStatus.FAILED, null, pending.skillId, "Action changed repeatedly.", true, null),
        )
    }

    /** phone.call by raw number needs only Phone; by name it also needs Contacts. */
    private fun permissionsFor(skill: SkillDefinition, input: SkillInput): List<PermissionType> {
        if (skill.id != "phone.call") return skill.requiredPermissions
        val target = input.values["target"] as? String
        return if (target != null && PhoneCallSkillFactory.looksLikePhoneNumber(target)) {
            listOf(PermissionType.PHONE_CALL)
        } else {
            listOf(PermissionType.CONTACTS, PermissionType.PHONE_CALL)
        }
    }

    /** Each permission is explained under the capability it belongs to (e.g. Contacts, then Phone). */
    private fun groupByCapability(
        skill: SkillDefinition,
        primary: CapabilityDefinition?,
        permissions: List<PermissionType>,
    ): List<Pair<CapabilityDefinition, List<PermissionType>>> =
        permissions.mapNotNull { permission ->
            val owner = primary?.takeIf { permission in it.permissionTypes }
                ?: capabilities.usingPermission(permission).firstOrNull()
            owner?.let { it to permission }
        }.groupBy({ it.first }, { it.second }).toList()
            .also { require(it.isNotEmpty() || permissions.isEmpty()) { "No capability declares ${skill.id}'s permissions" } }

    private fun accessProblem(skill: SkillDefinition, capability: CapabilityDefinition, status: ToolResultStatus, message: String) =
        TurnOutcome(
            message = message,
            result = ToolResult(false, status, capability.id.wireId, skill.id, message, retryable = true, verificationEvidence = null),
        )

    private fun unsupported(skill: SkillDefinition, capability: CapabilityDefinition, reason: String? = null): TurnOutcome {
        val message = reason?.let { "$it ${capability.fallback}" }
            ?: "${capability.name} isn't available in this version of ZARVIS. ${capability.android.note}"
        return TurnOutcome(message, ToolResult(false, ToolResultStatus.UNSUPPORTED, capability.id.wireId, skill.id, message, false, null))
    }
}

internal fun StructuredResultDto.toDomain(): ToolResult = ToolResult(
    success = success,
    status = runCatching { ToolResultStatus.valueOf(status) }.getOrDefault(ToolResultStatus.FAILED),
    capabilityId = capabilityId,
    skillId = skillId,
    userSafeMessage = userSafeMessage,
    retryable = retryable,
    verificationEvidence = null,
)
