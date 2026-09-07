package com.zarvismobile.feature.onboarding

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.data.local.prefs.AppPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class OnboardingUiState(
    val pageIndex: Int = 0,
    val pageCount: Int = OnboardingPages.all.size,
    val complete: Boolean = false,
)

/** Drives the onboarding flow described in MASTER_SPEC.md §15 — progressive, not overwhelming. */
@HiltViewModel
class OnboardingViewModel @Inject constructor(
    private val preferences: AppPreferences,
) : ViewModel() {

    private val _uiState = MutableStateFlow(OnboardingUiState())
    val uiState: StateFlow<OnboardingUiState> = _uiState.asStateFlow()

    fun next() {
        val state = _uiState.value
        if (state.pageIndex < state.pageCount - 1) {
            _uiState.value = state.copy(pageIndex = state.pageIndex + 1)
        } else {
            finish()
        }
    }

    fun skip() = finish()

    private fun finish() {
        viewModelScope.launch {
            preferences.setOnboardingComplete(true)
            _uiState.value = _uiState.value.copy(complete = true)
        }
    }
}
