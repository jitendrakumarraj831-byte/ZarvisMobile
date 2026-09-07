package com.zarvismobile.feature.conversation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.agents.AndroidOrchestrator
import com.zarvismobile.core.common.metrics.TurnMetricsStore
import com.zarvismobile.core.common.voice.SpeechToTextEngine
import com.zarvismobile.core.common.voice.TextToSpeechEngine
import com.zarvismobile.core.ui.components.VoiceState
import com.zarvismobile.data.repository.SessionRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlin.time.measureTimedValue
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val SUCCESS_FLASH_MS = 450L

data class ConversationTurn(val userText: String, val assistantText: String?)

data class ConversationUiState(
    val voiceState: VoiceState = VoiceState.IDLE,
    val composerText: String = "",
    val turns: List<ConversationTurn> = emptyList(),
    val error: String? = null,
)

/**
 * Drives the IDLE -> LISTENING -> UNDERSTANDING -> PLANNING -> EXECUTING -> SUCCESS ->
 * SPEAKING state machine from MASTER_SPEC.md §11, for both voice and text input (text always
 * stays available, per the same section). Every state transition is visible to the user via
 * [ConversationUiState.voiceState] driving the AI Orb.
 */
@HiltViewModel
class ConversationViewModel @Inject constructor(
    private val orchestrator: AndroidOrchestrator,
    private val sessionRepository: SessionRepository,
    private val sttEngine: SpeechToTextEngine,
    private val ttsEngine: TextToSpeechEngine,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ConversationUiState())
    val uiState: StateFlow<ConversationUiState> = _uiState.asStateFlow()

    fun onComposerChange(text: String) {
        _uiState.update { it.copy(composerText = text) }
    }

    fun submitComposerText() {
        val text = _uiState.value.composerText.trim()
        if (text.isBlank()) return
        _uiState.update { it.copy(composerText = "") }
        runTurn(text)
    }

    /** Called once by the screen when it was navigated to with a pre-filled utterance (MASTER_SPEC.md §23). */
    fun submitInitialText(text: String) {
        if (text.isBlank()) return
        runTurn(text)
    }

    fun startListening() {
        _uiState.update { it.copy(voiceState = VoiceState.LISTENING, error = null) }
        viewModelScope.launch {
            try {
                sttEngine.listen(locale = "en-IN").collect { update ->
                    _uiState.update { it.copy(composerText = update.text) }
                    if (update.isFinal) {
                        sttEngine.stop()
                        runTurn(update.text)
                    }
                }
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
        viewModelScope.launch {
            _uiState.update {
                it.copy(voiceState = VoiceState.UNDERSTANDING, turns = it.turns + ConversationTurn(utterance, null), error = null)
            }
            try {
                val accountId = sessionRepository.requireAccountId()
                _uiState.update { it.copy(voiceState = VoiceState.PLANNING) }
                _uiState.update { it.copy(voiceState = VoiceState.EXECUTING) }
                val timedOutcome = measureTimedValue { orchestrator.handleTurn(utterance, accountId) }
                val outcome = timedOutcome.value
                TurnMetricsStore.record(utterance, timedOutcome.duration.inWholeMilliseconds, success = true)

                _uiState.update { state ->
                    state.copy(turns = replaceLastAssistantReply(state.turns, utterance, outcome.message), voiceState = VoiceState.SUCCESS)
                }
                delay(SUCCESS_FLASH_MS)
                _uiState.update { it.copy(voiceState = VoiceState.SPEAKING) }
                ttsEngine.speak(outcome.message, locale = "en-IN")
                _uiState.update { it.copy(voiceState = VoiceState.IDLE) }
            } catch (t: Throwable) {
                val message = "Something went wrong: ${t.message ?: "unknown error"}"
                TurnMetricsStore.record(utterance, durationMs = 0L, success = false)
                _uiState.update { state ->
                    state.copy(
                        turns = replaceLastAssistantReply(state.turns, utterance, message),
                        voiceState = VoiceState.ERROR,
                        error = message,
                    )
                }
            }
        }
    }

    private fun replaceLastAssistantReply(turns: List<ConversationTurn>, userText: String, reply: String): List<ConversationTurn> {
        if (turns.isEmpty()) return listOf(ConversationTurn(userText, reply))
        return turns.dropLast(1) + ConversationTurn(userText, reply)
    }
}
