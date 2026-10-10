package com.zarvismobile.feature.tasks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.TaskDto
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class TasksUiState(
    val tasks: List<TaskDto> = emptyList(),
    val isLoading: Boolean = true,
    /** The list could not be loaded. */
    val error: String? = null,
    /** A Pause or Cancel was refused or never arrived; the list shown is still the last good one. */
    val actionFailed: Boolean = false,
)

/** Backs the Task Engine's client view: list, pause and cancel. No executor exists yet, so nothing starts a task. */
@HiltViewModel
class TasksViewModel @Inject constructor(
    private val api: ZarvisApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TasksUiState())
    val uiState: StateFlow<TasksUiState> = _uiState.asStateFlow()

    /** Reads the list. The screen calls this every time it is shown (the tab outlives a visit elsewhere), so the list is never an old one. */
    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null, actionFailed = false)
            try {
                _uiState.value = TasksUiState(tasks = api.getTasks().tasks, isLoading = false)
            } catch (t: Throwable) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = t.message ?: "Couldn't load tasks.")
            }
        }
    }

    fun pause(taskId: String) = transition(taskId, "pause")
    fun cancel(taskId: String) = transition(taskId, "cancel")

    private fun transition(taskId: String, action: String) {
        viewModelScope.launch {
            try {
                api.transitionTask(taskId, action)
                refresh()
            } catch (t: Throwable) {
                _uiState.value = _uiState.value.copy(actionFailed = true)
            }
        }
    }
}
