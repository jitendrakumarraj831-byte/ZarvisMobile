package com.zarvismobile.feature.conversation

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.agents.AndroidOrchestrator
import com.zarvismobile.core.common.metrics.TurnMetricsStore
import com.zarvismobile.core.common.voice.SpeechToTextEngine
import com.zarvismobile.core.common.voice.TextToSpeechEngine
import com.zarvismobile.core.ui.components.VoiceState
import com.zarvismobile.data.repository.SessionExpiredException
import com.zarvismobile.data.repository.SessionRepository
import com.zarvismobile.domain.access.AccessCoordinator
import com.zarvismobile.domain.access.AccessResult
import com.zarvismobile.domain.access.PendingAction
import com.zarvismobile.domain.access.RecoveryDecision
import com.zarvismobile.domain.capability.CapabilityId
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.conversation.ConversationStamp
import com.zarvismobile.domain.entity.ToolResultStatus
import com.zarvismobile.domain.presentation.ConversationSync
import com.zarvismobile.domain.presentation.OwnReply
import com.zarvismobile.domain.presentation.Reconciled
import com.zarvismobile.domain.presentation.ServerConversation
import com.zarvismobile.domain.presentation.TurnText
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlin.time.measureTimedValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val SUCCESS_FLASH_MS = 450L
private const val START_REQUEST_HANDLED = "conversation.startRequestHandled"

data class ConversationTurn(
    val userText: String,
    val assistantText: String?,
    /** Structured status of the tool action behind this reply, when there was one. */
    val status: ToolResultStatus? = null,
)

data class ConversationUiState(
    val voiceState: VoiceState = VoiceState.IDLE,
    val composerText: String = "",
    val turns: List<ConversationTurn> = emptyList(),
    val error: String? = null,
    /** An action that was waiting on the user when the app process was killed. */
    val interrupted: PendingAction? = null,
    val notice: String? = null,
)

/**
 * Conversation state machine with truthful states only:
 * IDLE → LISTENING (mic open) → UNDERSTANDING (request in flight) → SUCCESS / ERROR →
 * SPEAKING (only while audio is actually playing, and only when spoken replies are on).
 */
@HiltViewModel
class ConversationViewModel @Inject constructor(
    private val orchestrator: AndroidOrchestrator,
    private val sessionRepository: SessionRepository,
    private val sttEngine: SpeechToTextEngine,
    private val ttsEngine: TextToSpeechEngine,
    private val preferences: ChatPreferences,
    private val access: AccessCoordinator,
    private val capabilities: CapabilityRegistry,
    private val savedState: SavedStateHandle,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ConversationUiState())
    val uiState: StateFlow<ConversationUiState> = _uiState.asStateFlow()

    // The in-flight turn, so tapping the orb interrupts it cleanly (network call or playback).
    private var turnJob: Job? = null

    // Set once the first restore has finished, so the first resume does not ask the server for the same history twice.
    // (Declared before `init`: the coroutine started there may run right away, and a later initializer would reset it.)
    private var restoredOnce = false

    // The conversation the transcript on this screen belongs to. The active conversation (orchestrator.conversation) is the single source of truth;
    // whenever it is no longer this one, what this screen shows is from a conversation the device has left and is dropped.
    private var shown: ConversationStamp? = null

    init {
        viewModelScope.launch {
            shown = orchestrator.conversation.current()
            // Process-death recovery: offer, never auto-run.
            when (val decision = orchestrator.checkInterruptedAction()) {
                is RecoveryDecision.OfferResume -> _uiState.update { it.copy(interrupted = decision.action) }
                is RecoveryDecision.Expired -> _uiState.update {
                    it.copy(notice = "An earlier request (\"${decision.action.utterance}\") was interrupted before it finished. Nothing was done.")
                }
                RecoveryDecision.Nothing -> Unit
            }
            // Show only real, server-persisted history for the conversation this device continues.
            reconcileWithServer()
            restoredOnce = true
        }
        // The Chat tab and a chat opened from Home share ONE active conversation. When the device leaves it (a New chat on either screen, a
        // different account, a conversation the server no longer has), every screen watching drops what it shows, even one that was not on screen.
        viewModelScope.launch {
            orchestrator.conversation.state.filterNotNull().collect { onActiveConversation(it) }
        }
    }

    private fun onActiveConversation(active: ConversationStamp) {
        if (!ConversationSync.leftConversation(shown, active)) return
        // A turn still on its way belongs to the conversation that was left: it must not land in this one.
        turnJob?.cancel()
        shown = active
        // The recovery card and notice are about the app being closed, not about this conversation: they stay.
        _uiState.update { it.copy(turns = emptyList(), voiceState = VoiceState.IDLE, error = null) }
        // Another screen may already be talking in the new chat: show what the server holds for it.
        if (active.id != null) viewModelScope.launch { reconcileWithServer() }
    }

    private fun leftConversation(): Boolean =
        orchestrator.conversation.state.value?.let { ConversationSync.leftConversation(shown, it) } == true

    /**
     * Called whenever the screen is shown again. If the other Chat screen continued this conversation meanwhile, the exchanges the server
     * has after the ones shown here are added below them (the ones already shown, with their status chips, are left as they are). If what is
     * shown is from another conversation than the active one, it is replaced. A turn in flight is never touched; and if this screen is not
     * simply the start of the server's conversation (it holds a phone-only exchange the server never stored), nothing is changed rather than
     * showing a wrong transcript.
     */
    fun syncWithServer() {
        if (!restoredOnce || turnJob?.isActive == true) return
        viewModelScope.launch { reconcileWithServer() }
    }

    private suspend fun reconcileWithServer() {
        val restored = runCatching { orchestrator.restoreConversation() }.getOrNull() ?: return
        val active = orchestrator.conversation.current()
        val before = _uiState.value.turns
        val decision = ConversationSync.reconcile(
            shown = shown,
            shownUsers = before.map { it.userText }.filter { it.isNotEmpty() },
            shownCount = before.size,
            server = ServerConversation(restored.conversation, restored.messages.map { it.role to it.content }),
            active = active,
        )
        when (decision) {
            Reconciled.Keep -> Unit
            // Only if nothing changed while the server was answering (a New chat or a new turn in between would make this stale).
            is Reconciled.Append -> if (turnJob?.isActive != true && _uiState.value.turns.size == before.size) {
                shown = decision.stamp
                _uiState.update { it.copy(turns = it.turns + turnsOf(decision.turns)) }
            }
            is Reconciled.Replace -> if (turnJob?.isActive != true) {
                shown = decision.stamp
                _uiState.update { it.copy(turns = turnsOf(decision.turns)) }
            }
        }
    }

    fun onComposerChange(text: String) {
        _uiState.update { it.copy(composerText = text) }
    }

    fun submitComposerText() {
        val text = _uiState.value.composerText.trim()
        if (text.isBlank()) return
        _uiState.update { it.copy(composerText = "") }
        runTurn(text)
    }

    fun prefillComposer(text: String) {
        _uiState.update { it.copy(composerText = text) }
    }

    fun submitInitialText(text: String) {
        if (text.isBlank()) return
        runTurn(text)
    }

    /**
     * The screen's start request (text from Home/Assist, or "listen now") is handled once per
     * navigation entry. The composable's LaunchedEffect runs again after a rotation or after
     * the process is recreated; without this, that re-sent the same request — a duplicate
     * turn and a duplicate AI call. Stored in SavedStateHandle so it survives process death.
     */
    fun onStartRequest(initialText: String?, submit: Boolean, listen: Boolean) {
        if (savedState.get<Boolean>(START_REQUEST_HANDLED) == true) return
        savedState[START_REQUEST_HANDLED] = true
        if (listen) startListening()
        if (!initialText.isNullOrBlank()) {
            if (submit) submitInitialText(initialText) else prefillComposer(initialText)
        }
    }

    /** Re-runs the interrupted request through the full permission + confirmation flow. */
    fun resumeInterrupted() {
        val action = _uiState.value.interrupted ?: return
        _uiState.update { it.copy(interrupted = null) }
        runTurn(action.utterance)
    }

    fun dismissInterrupted() {
        _uiState.update { it.copy(interrupted = null) }
        viewModelScope.launch { orchestrator.dismissInterruptedAction() }
    }

    fun dismissNotice() {
        _uiState.update { it.copy(notice = null) }
    }

    fun startNewConversation() {
        turnJob?.cancel()
        // Gone from this screen at once, before anything is written; every other screen drops it when it sees the new conversation.
        _uiState.update { ConversationUiState() }
        viewModelScope.launch {
            val fresh = orchestrator.startNewConversation()
            if ((shown?.epoch ?: -1L) < fresh.epoch) shown = fresh
        }
    }

    fun startListening() {
        if (_uiState.value.voiceState == VoiceState.LISTENING) return
        turnJob?.cancel()
        ttsEngine.stop()
        viewModelScope.launch {
            // Microphone goes through the same permission intelligence as every capability.
            when (val result = access.ensure(capabilities.get(CapabilityId.MICROPHONE))) {
                AccessResult.Granted -> Unit
                else -> {
                    val reason = when (result) {
                        is AccessResult.Declined -> "Voice input stays off. You can type instead."
                        is AccessResult.Denied -> "Microphone access is off, so voice input can't start. You can type instead."
                        else -> "Voice input isn't available on this device. You can type instead."
                    }
                    _uiState.update { it.copy(voiceState = VoiceState.IDLE, error = reason) }
                    return@launch
                }
            }
            _uiState.update { it.copy(voiceState = VoiceState.LISTENING, error = null) }
            try {
                val locale = if (preferences.locale.first() == "hi") "hi-IN" else "en-US"
                sttEngine.listen(locale = locale).collect { update ->
                    _uiState.update { it.copy(composerText = update.text) }
                    if (update.isFinal) {
                        sttEngine.stop()
                        _uiState.update { it.copy(composerText = "") }
                        runTurn(update.text)
                    }
                }
                if (_uiState.value.voiceState == VoiceState.LISTENING) _uiState.update { it.copy(voiceState = VoiceState.IDLE) }
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _uiState.update { it.copy(voiceState = VoiceState.ERROR, error = t.message ?: "Couldn't hear that.") }
            }
        }
    }

    fun cancelListening() {
        sttEngine.stop()
        if (_uiState.value.voiceState == VoiceState.LISTENING) {
            _uiState.update { it.copy(voiceState = VoiceState.IDLE) }
        }
    }

    private fun runTurn(utterance: String) {
        // One turn at a time: a new request (typed, voice, resume) supersedes the one in flight
        // instead of running beside it and writing its reply into the wrong bubble.
        turnJob?.cancel()
        ttsEngine.stop()
        turnJob = viewModelScope.launch {
            _uiState.update {
                it.copy(voiceState = VoiceState.UNDERSTANDING, turns = it.turns + ConversationTurn(utterance, null), error = null)
            }
            try {
                val accountId = sessionRepository.ensureSession()
                val locale = if (preferences.locale.first() == "hi") "hi-IN" else "en-US"
                val timed = measureTimedValue { orchestrator.handleTurn(utterance, accountId, locale = locale.take(2)) }
                val outcome = timed.value
                // Only a COMPLETED action flashes success. A hand-off (USER_ACTION_REQUIRED, e.g. the
                // alarm opened in the Clock app) has `success = true` but nothing is done yet.
                val succeeded = outcome.result?.let { it.status == ToolResultStatus.COMPLETED } ?: true
                TurnMetricsStore.record(
                    label = outcome.result?.skillId ?: "conversation",
                    durationMs = timed.duration.inWholeMilliseconds,
                    success = succeeded,
                )
                // The device may have left this conversation (a New chat on another screen) while the reply was on its way: it is not shown here.
                val reply = ConversationSync.finishOwnTurn(shown, outcome.conversation, outcome.replacedConversation, orchestrator.conversation.state.value)
                if (reply is OwnReply.Discard) {
                    orchestrator.conversation.state.value?.let(::onActiveConversation)
                    return@launch
                }
                shown = when (reply) {
                    is OwnReply.Show -> reply.stamp
                    is OwnReply.Fresh -> reply.stamp
                    OwnReply.Discard -> shown
                } ?: shown
                _uiState.update { state ->
                    state.copy(
                        turns = if (reply is OwnReply.Fresh) {
                            listOf(ConversationTurn(utterance, outcome.message, outcome.result?.status))
                        } else {
                            replaceLastAssistantReply(state.turns, utterance, outcome.message, outcome.result?.status)
                        },
                        voiceState = if (succeeded) VoiceState.SUCCESS else VoiceState.IDLE,
                    )
                }
                if (succeeded) delay(SUCCESS_FLASH_MS)
                if (preferences.autoSpeak.first()) {
                    try {
                        ttsEngine.speak(outcome.message, locale = locale) {
                            _uiState.update { it.copy(voiceState = VoiceState.SPEAKING) }
                        }
                        _uiState.update { it.copy(voiceState = VoiceState.IDLE) }
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Throwable) {
                        _uiState.update { it.copy(voiceState = VoiceState.IDLE, error = "Voice playback failed — the reply is shown as text.") }
                    }
                } else {
                    _uiState.update { it.copy(voiceState = VoiceState.IDLE) }
                }
            } catch (t: CancellationException) {
                throw t
            } catch (e: SessionExpiredException) {
                failTurn(utterance, "Your session has ended. Sign in again to continue.")
            } catch (t: Throwable) {
                TurnMetricsStore.record("conversation", durationMs = 0L, success = false)
                failTurn(utterance, "I couldn't reach ZARVIS, so nothing was done. Check your connection and try again.")
            }
        }
    }

    private fun failTurn(utterance: String, message: String) {
        // The screen was already reset because the device left this conversation: the failure of a turn that belonged to it is not shown.
        if (leftConversation()) return
        _uiState.update { state ->
            state.copy(
                turns = replaceLastAssistantReply(state.turns, utterance, message, ToolResultStatus.FAILED),
                voiceState = VoiceState.ERROR,
                error = message,
            )
        }
    }

    private fun replaceLastAssistantReply(
        turns: List<ConversationTurn>,
        userText: String,
        reply: String,
        status: ToolResultStatus?,
    ): List<ConversationTurn> {
        if (turns.isEmpty()) return listOf(ConversationTurn(userText, reply, status))
        return turns.dropLast(1) + ConversationTurn(userText, reply, status)
    }
}

private fun turnsOf(texts: List<TurnText>): List<ConversationTurn> = texts.map { ConversationTurn(it.user, it.assistant) }
