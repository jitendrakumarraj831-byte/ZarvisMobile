package com.zarvismobile.agents

import com.zarvismobile.core.tooling.ComposeConfirmationPort
import com.zarvismobile.data.remote.AiServiceErrors
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.DeviceActionDto
import com.zarvismobile.data.remote.dto.DeviceActionResultRequest
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
import com.zarvismobile.domain.conversation.ActiveConversation
import com.zarvismobile.domain.conversation.Adoption
import com.zarvismobile.domain.conversation.ConversationStamp
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

/**
 * The result of one turn. [conversation] is the server conversation the reply was recorded under (`null` for an action done on the phone, which
 * is not part of one), and [replacedConversation] is true when the server did not know the conversation the turn was sent to and answered in a
 * new one. A screen compares [conversation] with the active conversation before it shows the reply: if the device left that conversation while
 * the turn was on its way, the reply is not shown.
 */
data class TurnOutcome(
    val message: String,
    val result: ToolResult? = null,
    val conversation: ConversationStamp? = null,
    val replacedConversation: Boolean = false,
)

data class RestoredMessage(val role: String, val content: String)

/** The server's messages for the active conversation, and the conversation (the id and epoch) they were asked for. */
data class RestoredConversation(val conversation: ConversationStamp, val messages: List<RestoredMessage>)

/** What deleting the active chat did. */
enum class ConversationDeletion {
    /** The server deleted it (or said it no longer has it) and the device has left it. */
    DELETED,

    /** The chat had no server id yet (nothing was answered), so there was nothing to delete: the device just started a new one. */
    NOTHING_SAVED,

    /** The server still has it (no connection, an error, or a server without the delete route). Nothing changed on the device. */
    FAILED,
}

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
 *
 * Brain → device handoff: every Brain turn lists the phone actions this app runs, and the Brain may answer with one of them
 * ("show me my gallery" → phone.open_app) instead of explaining manual steps. It is run on the device path above, permission and
 * confirmation included, and its real result is the reply (ZARVIS_ASSISTANT_UPGRADE_PLAN.md Phase 6).
 */
class AndroidOrchestrator(
    private val onDeviceRegistry: SkillRegistry,
    private val onDevicePipeline: ToolPipeline,
    private val api: ZarvisApi,
    private val confirmationPort: ComposeConfirmationPort,
    private val capabilities: CapabilityRegistry,
    private val access: AccessCoordinator,
    private val pendingActions: PendingActionStore,
    /** The single source of truth for which server conversation is active (see [ActiveConversation]). */
    val conversation: ActiveConversation,
    private val clock: ClockPort,
) {
    private val matcher = KeywordSkillMatcher(onDeviceRegistry)

    suspend fun handleTurn(utterance: String, accountId: String, locale: String = "en"): TurnOutcome {
        val skill = matcher.matchCommand(utterance)
        return if (skill != null) handleOnDevice(skill, utterance, accountId, locale) else handleWithBrain(utterance, accountId, locale)
    }

    /** Called at startup: an action interrupted by process death is offered again, never auto-run. */
    suspend fun checkInterruptedAction(): RecoveryDecision {
        val decision = PendingActionRecovery.decide(pendingActions.load(), clock.now())
        if (decision is RecoveryDecision.Expired) pendingActions.clear()
        return decision
    }

    suspend fun dismissInterruptedAction() = pendingActions.clear()

    /** Loads only real, server-persisted history for the conversation this device is continuing, and says which conversation that was. */
    suspend fun restoreConversation(): RestoredConversation {
        val asked = conversation.current()
        val id = asked.id ?: return RestoredConversation(asked, emptyList())
        return try {
            RestoredConversation(asked, api.conversationMessages(id).messages.map { RestoredMessage(it.role, it.content) })
        } catch (e: retrofit2.HttpException) {
            if (e.code() == 404) conversation.forget(id) // gone (e.g. account changed) — leave it, don't fabricate it
            RestoredConversation(asked, emptyList())
        }
    }

    /** New chat: the device leaves the active conversation, for every screen at once. */
    suspend fun startNewConversation(): ConversationStamp = conversation.startNew()

    /**
     * Deletes the active chat on the server and, only after the server confirmed it, leaves it on this device for every screen. A failure
     * changes nothing, so a chat is never shown as deleted while the server still has it.
     */
    suspend fun deleteConversation(): ConversationDeletion {
        val id = conversation.current().id
        if (id == null) {
            conversation.startNew()
            return ConversationDeletion.NOTHING_SAVED
        }
        val gone = try {
            api.deleteConversation(id)
            true
        } catch (e: retrofit2.HttpException) {
            // 404 counts as "already gone" only when the server says THIS chat does not exist: a server without the route also answers 404.
            e.code() == 404 && e.response()?.errorBody()?.string()?.contains("conversation_not_found") == true
        } catch (e: java.io.IOException) {
            false
        }
        if (!gone) return ConversationDeletion.FAILED
        conversation.forget(id)
        return ConversationDeletion.DELETED
    }

    private suspend fun handleOnDevice(
        skill: SkillDefinition,
        utterance: String,
        accountId: String,
        locale: String,
        input: SkillInput = OnDeviceInputBuilder.build(skill, utterance),
    ): TurnOutcome {
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

    private suspend fun handleWithBrain(utterance: String, accountId: String, locale: String): TurnOutcome {
        // The conversation this turn is sent to. The answer is recorded under it only if the device is still in it when the answer arrives.
        val sent = conversation.current()
        var recorded = sent
        var replaced = false
        var stale = false
        fun outcome(message: String, result: ToolResult?) = TurnOutcome(message, result, recorded, replaced)

        val response = try {
            api.runTurn(
                OrchestratorTurnRequest(utterance = utterance, locale = locale, conversationId = sent.id, deviceActions = deviceActionIds()),
            )
        } catch (e: retrofit2.HttpException) {
            // An exhausted AI quota / rate limit is an honest answer, not "check your connection".
            val error = AiServiceErrors.classify(e.code(), e.response()?.errorBody()?.string()) ?: throw e
            return outcome(
                error.message,
                ToolResult(false, ToolResultStatus.FAILED, null, "conversation", error.message, error.retryable, null),
            )
        }
        response.conversationId?.let { id ->
            val adoption = conversation.adopt(id, sent.epoch)
            // A reply for a conversation the device left keeps the stamp it was sent under, so every screen can see it is from the past.
            if (adoption !is Adoption.Stale) recorded = adoption.stamp
            replaced = adoption is Adoption.Replaced
            stale = adoption is Adoption.Stale
        }
        response.deviceAction?.let { action ->
            // The user left the chat this was asked in (New chat, another chat) while it was on its way: nothing runs on the phone.
            if (stale) {
                val message = "That request was for a chat you have left, so nothing was done on the phone."
                return outcome(message, ToolResult(false, ToolResultStatus.FAILED, null, action.skillId, message, true, null))
            }
            val done = runDeviceAction(action, utterance, accountId, locale)
            response.conversationId?.let { id -> reportDeviceResult(id, action, done) }
            return done.copy(conversation = recorded, replacedConversation = replaced)
        }
        val lastResult = response.toolCalls.lastOrNull()?.result?.toDomain()
        var pending = response.toolCalls.firstNotNullOfOrNull { it.outcome.confirmation }
            ?: return outcome(response.message, lastResult)

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
                if (e.code() == 409) {
                    // A retried approve: the first one already ran the action exactly once.
                    return outcome(
                        "That was already approved: the action ran once and will not run again. Its result is in the conversation.",
                        ToolResult(false, ToolResultStatus.USER_ACTION_REQUIRED, null, pending.skillId, "Already approved; ran once.", false, null),
                    )
                }
                if (e.code() == 404) {
                    return outcome(
                        "That confirmation expired or was already used, so nothing was run. Ask again if you still want it.",
                        ToolResult(false, ToolResultStatus.FAILED, null, pending.skillId, "Confirmation expired.", true, null),
                    )
                }
                throw e
            }
            pending = resolution.outcome?.confirmation
                ?: return outcome(resolution.message, resolution.result.toDomain())
        }
        return outcome(
            "The action kept changing before it could run, so nothing was done. Please ask again.",
            ToolResult(false, ToolResultStatus.FAILED, null, pending.skillId, "Action changed repeatedly.", true, null),
        )
    }

    /**
     * The phone actions offered to the Brain: every on-device skill whose capability this version runs on Android. The server keeps only the
     * ids it describes (backend/src/capabilities/deviceActions.ts) and offers none when the list is absent.
     */
    private fun deviceActionIds(): List<String>? =
        onDeviceRegistry.all().filter { capabilities.find(it.capabilityId)?.implementedOnAndroid != false }.map { it.id }.ifEmpty { null }

    /**
     * Runs a phone action the Brain chose exactly as a spoken command runs (Android permission explained first, then the confirmation the
     * action requires). The Brain's input is used as given; the words of the request fill in only optional fields it left out (a reminder's
     * title), never a required one such as who to call, so a missing field fails validation instead of being guessed.
     */
    private suspend fun runDeviceAction(action: DeviceActionDto, utterance: String, accountId: String, locale: String): TurnOutcome {
        val skill = onDeviceRegistry.find(action.skillId)
        if (skill == null) {
            val message = "I can't do that on this phone yet, so nothing was done."
            return TurnOutcome(message, ToolResult(false, ToolResultStatus.UNSUPPORTED, null, action.skillId, message, false, null))
        }
        val fromWords = OnDeviceInputBuilder.build(skill, utterance).values.filterKeys { it !in skill.inputSchema.requiredFields }
        val input = SkillInput(fromWords + action.input.filterValues { it.isNotBlank() })
        return handleOnDevice(skill, utterance, accountId, locale, input)
    }

    /**
     * Records what the phone really did as the turn's reply in the conversation. Best effort: a report that does not arrive leaves that
     * reply out of the conversation's history, never a wrong one in it, and the user has already been told the result.
     */
    private suspend fun reportDeviceResult(conversationId: String, action: DeviceActionDto, done: TurnOutcome) {
        val request = DeviceActionResultRequest(
            conversationId = conversationId,
            toolCallId = action.toolCallId,
            skillId = action.skillId,
            status = (done.result?.status ?: ToolResultStatus.FAILED).name,
            message = done.message,
        )
        try {
            api.reportDeviceResult(request)
        } catch (e: java.io.IOException) {
            // No connection: see above.
        }
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
