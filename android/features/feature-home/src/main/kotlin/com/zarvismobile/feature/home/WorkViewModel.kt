package com.zarvismobile.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.EntitlementSnapshotResponse
import com.zarvismobile.data.remote.dto.MemoryOverviewResponse
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** One line on a Work card, loaded on its own so one failing call never blanks the others. */
sealed interface Fetched<out T> {
    data object Loading : Fetched<Nothing>
    data object Failed : Fetched<Nothing>
    data class Ready<T>(val value: T) : Fetched<T>
}

data class WorkUiState(
    /** How many tasks the account has (the list itself is on the Tasks screen). */
    val taskCount: Fetched<Int> = Fetched.Loading,
    val memory: Fetched<MemoryOverviewResponse> = Fetched.Loading,
    val plan: Fetched<EntitlementSnapshotResponse> = Fetched.Loading,
)

/**
 * The live numbers on the Work page's cards (tasks, memory, plan), read from the same endpoints the screens behind them use.
 * Nothing is invented: a failed call shows as "Couldn't load", not as zero.
 */
@HiltViewModel
class WorkViewModel @Inject constructor(
    private val api: ZarvisApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(WorkUiState())
    val uiState: StateFlow<WorkUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        _uiState.value = WorkUiState()
        viewModelScope.launch {
            val result = fetch { api.getTasks().tasks.size }
            _uiState.update { it.copy(taskCount = result) }
        }
        viewModelScope.launch {
            val result = fetch { api.getMemory() }
            _uiState.update { it.copy(memory = result) }
        }
        viewModelScope.launch {
            val result = fetch { api.getEntitlements() }
            _uiState.update { it.copy(plan = result) }
        }
    }

    private suspend fun <T> fetch(block: suspend () -> T): Fetched<T> =
        try {
            Fetched.Ready(block())
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (t: Throwable) {
            Fetched.Failed
        }
}
