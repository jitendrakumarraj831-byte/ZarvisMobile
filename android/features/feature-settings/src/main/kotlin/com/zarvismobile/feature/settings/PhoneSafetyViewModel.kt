package com.zarvismobile.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.domain.policy.AutomationHistoryStore
import com.zarvismobile.domain.policy.AutomationOutcome
import com.zarvismobile.domain.policy.AutomationPauseStore
import com.zarvismobile.domain.policy.AutomationPolicy
import com.zarvismobile.domain.policy.AutomationRecord
import com.zarvismobile.domain.policy.PolicyPromise
import com.zarvismobile.domain.presentation.StatusTone
import com.zarvismobile.domain.presentation.UiString
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PhoneSafetyUiState(
    /** Whether phone actions are paused, or null while the setting has not been read. */
    val paused: Boolean? = null,
    /** The setting could not be read; phone actions are refused until it can (the pipeline fails closed). */
    val readFailed: Boolean = false,
    /** The history could not be read; the list shown is the last one read. */
    val historyReadFailed: Boolean = false,
    /** The last change (pause, resume, clear) was not saved; what is shown is what the phone still holds. */
    val saveFailed: Boolean = false,
    /** Newest first, as kept on this phone. */
    val history: List<AutomationRecord> = emptyList(),
)

/**
 * Settings › Phone action safety: pause or resume every phone action, read what ZARVIS never does (shared/automation-policy.json), and
 * see or clear the history of phone actions kept on this phone. Everything shown is what the phone's store holds right now.
 */
@HiltViewModel
class PhoneSafetyViewModel @Inject constructor(
    private val pause: AutomationPauseStore,
    private val history: AutomationHistoryStore,
) : ViewModel() {

    /** What ZARVIS never does on the phone, from the policy the pipeline enforces. */
    val neverDoes: List<PolicyPromise> = AutomationPolicy.default.neverDoes

    private val _uiState = MutableStateFlow(PhoneSafetyUiState())
    val uiState: StateFlow<PhoneSafetyUiState> = _uiState.asStateFlow()

    private var reading: Job? = null

    init {
        load()
    }

    /** Reads the setting and the history again (also the Try again of an unreadable setting). */
    fun load() {
        reading?.cancel()
        _uiState.update { it.copy(readFailed = false, historyReadFailed = false) }
        reading = viewModelScope.launch {
            launch {
                pause.paused
                    .catch { _ -> _uiState.update { it.copy(readFailed = true) } }
                    .collect { paused -> _uiState.update { it.copy(paused = paused, readFailed = false) } }
            }
            launch {
                history.entries
                    .catch { _ -> _uiState.update { it.copy(historyReadFailed = true) } }
                    .collect { entries -> _uiState.update { it.copy(history = entries, historyReadFailed = false) } }
            }
        }
    }

    fun setPaused(paused: Boolean) = save { pause.setPaused(paused) }

    fun clearHistory() = save { history.clear() }

    private fun save(change: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                change()
                _uiState.update { it.copy(saveFailed = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { it.copy(saveFailed = true) }
            }
        }
    }
}

/** How a history entry's ending is named and coloured. */
internal fun AutomationOutcome.label(): UiString = when (this) {
    AutomationOutcome.DONE -> UiString.PHONE_SAFETY_OUTCOME_DONE
    AutomationOutcome.YOUR_TURN -> UiString.PHONE_SAFETY_OUTCOME_YOUR_TURN
    AutomationOutcome.DECLINED -> UiString.PHONE_SAFETY_OUTCOME_DECLINED
    AutomationOutcome.REFUSED -> UiString.PHONE_SAFETY_OUTCOME_REFUSED
    AutomationOutcome.PAUSED -> UiString.PHONE_SAFETY_OUTCOME_PAUSED
    AutomationOutcome.NEEDS_ACCESS -> UiString.PHONE_SAFETY_OUTCOME_NEEDS_ACCESS
    AutomationOutcome.FAILED -> UiString.PHONE_SAFETY_OUTCOME_FAILED
}

internal fun AutomationOutcome.tone(): StatusTone = when (this) {
    AutomationOutcome.DONE -> StatusTone.SUCCESS
    AutomationOutcome.YOUR_TURN, AutomationOutcome.NEEDS_ACCESS -> StatusTone.WAITING
    AutomationOutcome.REFUSED, AutomationOutcome.FAILED -> StatusTone.PROBLEM
    AutomationOutcome.DECLINED, AutomationOutcome.PAUSED -> StatusTone.NEUTRAL
}
