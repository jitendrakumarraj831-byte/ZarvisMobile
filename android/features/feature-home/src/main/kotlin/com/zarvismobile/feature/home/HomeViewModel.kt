package com.zarvismobile.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.EntitlementSnapshotResponse
import com.zarvismobile.data.remote.dto.SkillDto
import com.zarvismobile.data.remote.dto.TaskDto
import com.zarvismobile.domain.policy.AutomationPauseStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class HomeUiState(
    val skills: List<SkillDto> = emptyList(),
    val entitlement: EntitlementSnapshotResponse? = null,
    val tasks: List<TaskDto> = emptyList(),
    val isLoading: Boolean = true,
    val error: String? = null,
)

/**
 * Loads what the Home screen concept in MASTER_SPEC.md §22 needs: Recent Tasks and the plan from the live backend (never
 * hardcoded), and whether phone actions are paused, from this phone. Voice/text submission itself is handled by feature-conversation;
 * Home only navigates there (MASTER_SPEC.md §23).
 */
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val api: ZarvisApi,
    pauseStore: AutomationPauseStore,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    /**
     * Whether "Pause all phone actions" is on, for the Phone action safety row; `null` until it has been read. A setting that cannot
     * be read counts as paused, as it does where phone actions are run (the ToolPipeline refuses them then).
     */
    val phoneActionsPaused: StateFlow<Boolean?> = pauseStore.paused
        .catch { emit(true) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Reads skills, plan and tasks. The screen calls this every time Home is shown, so the plan and recent tasks are never old. */
    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                val skills = api.getSkills().skills
                val entitlement = api.getEntitlements()
                val tasks = api.getTasks().tasks
                _uiState.value = HomeUiState(skills = skills, entitlement = entitlement, tasks = tasks, isLoading = false)
            } catch (t: Throwable) {
                // Never fake success — surface the real failure (MASTER_SPEC.md Product Principle #4).
                _uiState.value = _uiState.value.copy(isLoading = false, error = t.message ?: "Couldn't reach ZARVIS right now.")
            }
        }
    }
}
