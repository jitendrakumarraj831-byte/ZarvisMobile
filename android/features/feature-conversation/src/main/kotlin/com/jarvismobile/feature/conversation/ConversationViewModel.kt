package com.jarvismobile.feature.conversation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jarvismobile.agents.AndroidOrchestrator
import com.jarvismobile.core.common.voice.SpeechToTextEngine
import com.jarvismobile.core.common.voice.TextToSpeechEngine
import com.jarvismobile.core.ui.components.VoiceState
import com.jarvismobile.data.repository.SessionRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ConversationTurn(val userText: String, val assistantText: String?)

data class ConversationUiState(
    val voiceState: VoiceState = VoiceState.IDLE,
    val composerText: String = "",
    val turns: List<ConversationTurn> = emptyList(),
    val error: String? = null,
)

/**
 * Drives the IDLE -> LISTENING -> UNDERSTANDING -> PLANNING -> EXECUTING -> SPEAKING state
 * machine from MASTER_SPEC.md §11, for both voice and text input (text always stays
 * available, per the same section).
 *
 * The whole listen -> understand -> plan -> execute -> speak sequence for one turn runs as a
 * single tracked [activeJob]. Every entry point that starts new work — [startListening],
 * [submitComposerText], [submitInitialText] — cancels any turn already in flight first, and
 * [cancelListening]/[interruptTurn] cancel it directly. This is what MASTER_SPEC.md §11 means
 * by "tapping the orb ... while SPEAKING/EXECUTING cancels the current turn cleanly (coroutine
 * cancellation, not force-kill)" — cancellation is real structured-concurrency cancellation,
 * not just overwriting UI state while the old work keeps running underneath it.
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

    private var activeJob: Job? = null

    fun onComposerChange(text: String) {
        _uiState.update { it.copy(composerText = text) }
    }

    /** Populates the composer without sending — see [ConversationScreen]'s `prefillText` doc. */
    fun prefillComposer(text: String) {
        _uiState.update { it.copy(composerText = text) }
    }

    fun submitComposerText() {
        val text = _uiState.value.composerText.trim()
        if (text.isBlank()) return
        _uiState.update { it.copy(composerText = "") }
        launchTurn(text)
    }

    /** Called once by the screen when it was navigated to with a pre-filled utterance (MASTER_SPEC.md §23). */
    fun submitInitialText(text: String) {
        if (text.isBlank()) return
        launchTurn(text)
    }

    fun startListening() {
        cancelActiveJob()
        _uiState.update { it.copy(voiceState = VoiceState.LISTENING, error = null) }
        activeJob = viewModelScope.launch {
            try {
                sttEngine.listen(locale = "en-IN").collect { update ->
                    _uiState.update { it.copy(composerText = update.text) }
                    if (update.isFinal) {
                        sttEngine.stop()
                        runTurn(update.text)
                    }
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                _uiState.update { it.copy(voiceState = VoiceState.ERROR, error = t.message ?: "Couldn't hear that.") }
            }
        }
    }

    /** Interrupts an in-progress LISTENING capture. */
    fun cancelListening() {
        cancelActiveJob()
        sttEngine.stop()
        _uiState.update { it.copy(voiceState = VoiceState.IDLE) }
    }

    /** Interrupts an in-progress UNDERSTANDING/PLANNING/EXECUTING/SPEAKING turn — see class doc. */
    fun interruptTurn() {
        cancelActiveJob()
        ttsEngine.stop()
        _uiState.update { it.copy(voiceState = VoiceState.IDLE) }
    }

    private fun cancelActiveJob() {
        activeJob?.cancel()
        activeJob = null
    }

    private fun launchTurn(utterance: String) {
        cancelActiveJob()
        activeJob = viewModelScope.launch { runTurn(utterance) }
    }

    private suspend fun runTurn(utterance: String) {
        _uiState.update {
            it.copy(voiceState = VoiceState.UNDERSTANDING, turns = it.turns + ConversationTurn(utterance, null), error = null)
        }
        try {
            val accountId = sessionRepository.requireAccountId()
            _uiState.update { it.copy(voiceState = VoiceState.PLANNING) }
            _uiState.update { it.copy(voiceState = VoiceState.EXECUTING) }
            val outcome = orchestrator.handleTurn(utterance, accountId)

            _uiState.update { state ->
                state.copy(turns = replaceLastAssistantReply(state.turns, utterance, outcome.message), voiceState = VoiceState.SPEAKING)
            }
            ttsEngine.speak(outcome.message, locale = "en-IN")
            _uiState.update { it.copy(voiceState = VoiceState.IDLE) }
        } catch (c: CancellationException) {
            throw c
        } catch (t: Throwable) {
            val message = "Something went wrong: ${t.message ?: "unknown error"}"
            _uiState.update { state ->
                state.copy(
                    turns = replaceLastAssistantReply(state.turns, utterance, message),
                    voiceState = VoiceState.ERROR,
                    error = message,
                )
            }
        }
    }

    private fun replaceLastAssistantReply(turns: List<ConversationTurn>, userText: String, reply: String): List<ConversationTurn> {
        if (turns.isEmpty()) return listOf(ConversationTurn(userText, reply))
        return turns.dropLast(1) + ConversationTurn(userText, reply)
    }
}
