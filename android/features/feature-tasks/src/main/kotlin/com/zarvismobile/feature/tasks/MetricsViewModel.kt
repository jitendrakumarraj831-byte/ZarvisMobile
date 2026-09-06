package com.zarvismobile.feature.tasks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.core.common.metrics.TurnMetric
import com.zarvismobile.core.common.metrics.TurnMetricsStore
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.TaskDto
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class MetricsUiState(
    val tasks: List<TaskDto> = emptyList(),
    val isLoading: Boolean = true,
    val error: String? = null,
)

/**
 * Drives the System Metrics screen (MASTER_SPEC.md §22 "Live API Latency & Logs Drawer").
 * [latencyLog] is real, on-device-measured latency of every orchestrator turn this session
 * (see [TurnMetricsStore]) — never a fabricated number. Task status is the same live data
 * already shown on Home/Tasks, reused here as the "logs" view; no new backend endpoint.
 */
@HiltViewModel
class MetricsViewModel @Inject constructor(
    private val api: ZarvisApi,
) : ViewModel() {

    val latencyLog: StateFlow<List<TurnMetric>> = TurnMetricsStore.metrics

    private val _uiState = MutableStateFlow(MetricsUiState())
    val uiState: StateFlow<MetricsUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                _uiState.value = MetricsUiState(tasks = api.getTasks().tasks, isLoading = false)
            } catch (t: Throwable) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = t.message ?: "Couldn't load task logs.")
            }
        }
    }
}
