package com.zarvismobile.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.EntitlementSnapshotResponse
import com.zarvismobile.data.remote.dto.TaskDto
import com.zarvismobile.domain.policy.AutomationPauseStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeUiState(
    val entitlement: EntitlementSnapshotResponse? = null,
    val tasks: List<TaskDto> = emptyList(),
    val isLoading: Boolean = true,
    /** The recent tasks could not be read on the last try: the section says so instead of "No tasks yet". */
    val tasksFailed: Boolean = false,
    /** The plan could not be read on the last try. */
    val planFailed: Boolean = false,
) {
    /** Something on Home could not be read: the error card with Try again is shown. */
    val failed: Boolean get() = tasksFailed || planFailed
}

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
    private var loading: Job? = null

    /**
     * Whether "Pause all phone actions" is on, for the Phone action safety row; `null` until it has been read. A setting that cannot
     * be read counts as paused, as it does where phone actions are run (the ToolPipeline refuses them then).
     */
    val phoneActionsPaused: StateFlow<Boolean?> = pauseStore.paused
        .catch { emit(true) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /**
     * Reads the recent tasks and the plan, each on its own, so one failing call never blanks the other (as on the Work tab). What is
     * shown stays while it is read again. The screen calls this every time Home is shown, so the plan and recent tasks are never old;
     * a read already on its way is not started a second time.
     */
    fun refresh() {
        if (loading?.isActive == true) return
        loading = viewModelScope.launch {
            // Try again answers at once: the error card goes while the read is out, and comes back only if it fails again.
            _uiState.update { it.copy(isLoading = true, tasksFailed = false, planFailed = false) }
            val tasks = async { fetch { api.getTasks().tasks } }
            val entitlement = async { fetch { api.getEntitlements() } }
            val loadedTasks = tasks.await()
            val loadedPlan = entitlement.await()
            // Never fake success: a failed read is said so (MASTER_SPEC.md Product Principle #4), and is never shown as no tasks.
            _uiState.update {
                it.copy(
                    tasks = loadedTasks ?: it.tasks,
                    entitlement = loadedPlan ?: it.entitlement,
                    isLoading = false,
                    tasksFailed = loadedTasks == null,
                    planFailed = loadedPlan == null,
                )
            }
        }
    }

    /** The answer, or `null` when the call failed. */
    private suspend fun <T> fetch(block: suspend () -> T): T? =
        try {
            block()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Throwable) {
            null
        }
}
