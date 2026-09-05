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
    val error: String? = null,
)

/** Backs the Task Engine's client view — pause/resume/cancel/retry per MASTER_SPEC.md §18. */
@HiltViewModel
class TasksViewModel @Inject constructor(
    private val api: ZarvisApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TasksUiState())
    val uiState: StateFlow<TasksUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                _uiState.value = TasksUiState(tasks = api.getTasks().tasks, isLoading = false)
            } catch (t: Throwable) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = t.message ?: "Couldn't load tasks.")
            }
        }
    }

    fun pause(taskId: String) = transition(taskId, "pause")
    fun resume(taskId: String) = transition(taskId, "resume")
    fun cancel(taskId: String) = transition(taskId, "cancel")
    fun retry(taskId: String) = transition(taskId, "retry")

    private fun transition(taskId: String, action: String) {
        viewModelScope.launch {
            try {
                api.transitionTask(taskId, action)
                refresh()
            } catch (t: Throwable) {
                _uiState.value = _uiState.value.copy(error = t.message ?: "That action couldn't be completed.")
            }
        }
    }
}
