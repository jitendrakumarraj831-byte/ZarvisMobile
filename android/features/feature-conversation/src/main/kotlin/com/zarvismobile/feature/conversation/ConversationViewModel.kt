package com.zarvismobile.feature.conversation

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.agents.AndroidOrchestrator
import com.zarvismobile.core.common.metrics.TurnMetricsStore
import com.zarvismobile.core.common.voice.SpeechToTextEngine
import com.zarvismobile.core.common.voice.TextToSpeechEngine
import com.zarvismobile.core.ui.components.VoiceState
import com.zarvismobile.data.local.prefs.AppPreferences
import com.zarvismobile.data.repository.SessionExpiredException
import com.zarvismobile.data.repository.SessionRepository
import com.zarvismobile.domain.access.AccessCoordinator
import com.zarvismobile.domain.access.AccessResult
import com.zarvismobile.domain.access.PendingAction
import com.zarvismobile.domain.access.RecoveryDecision
import com.zarvismobile.domain.capability.CapabilityId
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.entity.ToolResultStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlin.time.measureTimedValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
    private val preferences: AppPreferences,
    private val access: AccessCoordinator,
    private val capabilities: CapabilityRegistry,
    private val savedState: SavedStateHandle,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ConversationUiState())
    val uiState: StateFlow<ConversationUiState> = _uiState.asStateFlow()

    // The in-flight turn, so tapping the orb interrupts it cleanly (network call or playback).
    private var turnJob: Job? = null

    init {
        viewModelScope.launch {
            // Process-death recovery: offer, never auto-run.
            when (val decision = orchestrator.checkInterruptedAction()) {
                is RecoveryDecision.OfferResume -> _uiState.update { it.copy(interrupted = decision.action) }
                is RecoveryDecision.Expired -> _uiState.update {
                    it.copy(notice = "An earlier request (\"${decision.action.utterance}\") was interrupted before it finished. Nothing was done.")
                }
                RecoveryDecision.Nothing -> Unit
            }
            // Show only real, server-persisted history for the conversation this device continues.
            runCatching { orchestrator.restoreConversation() }.getOrNull()?.let { messages ->
                if (_uiState.value.turns.isEmpty() && messages.isNotEmpty()) {
                    _uiState.update { it.copy(turns = pairTurns(messages.map { m -> m.role to m.content })) }
                }
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
        viewModelScope.launch {
            orchestrator.startNewConversation()
            _uiState.update { ConversationUiState() }
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
                _uiState.update { state ->
                    state.copy(
                        turns = replaceLastAssistantReply(state.turns, utterance, outcome.message, outcome.result?.status),
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

/** Pairs restored user/assistant messages into turns without inventing missing halves. */
internal fun pairTurns(messages: List<Pair<String, String>>): List<ConversationTurn> {
    val turns = mutableListOf<ConversationTurn>()
    var pendingUser: String? = null
    for ((role, content) in messages) {
        when (role) {
            "user" -> {
                pendingUser?.let { turns += ConversationTurn(it, null) }
                pendingUser = content
            }
            "assistant" -> {
                turns += ConversationTurn(pendingUser ?: "", content)
                pendingUser = null
            }
        }
    }
    pendingUser?.let { turns += ConversationTurn(it, null) }
    return turns
}
