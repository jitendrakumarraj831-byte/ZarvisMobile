package com.zarvismobile.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.EntitlementSnapshotResponse
import com.zarvismobile.data.remote.dto.SkillDto
import com.zarvismobile.data.remote.dto.TaskDto
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class HomeUiState(
    val skills: List<SkillDto> = emptyList(),
    val entitlement: EntitlementSnapshotResponse? = null,
    val tasks: List<TaskDto> = emptyList(),
    val isLoading: Boolean = true,
    val error: String? = null,
)

/**
 * Loads what the Home screen concept in MASTER_SPEC.md §22 needs: quick categories (derived
 * from [HomeUiState.skills]), Recent Tasks, and Subscription Status — all from the live
 * backend, never hardcoded. Voice/text submission itself is handled by feature-conversation;
 * Home only navigates there (MASTER_SPEC.md §23).
 */
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val api: ZarvisApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

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
