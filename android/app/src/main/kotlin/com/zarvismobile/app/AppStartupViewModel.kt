package com.zarvismobile.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.data.local.prefs.AppPreferences
import com.zarvismobile.data.repository.SessionRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

sealed interface AppStartupState {
    data object Loading : AppStartupState
    data class Ready(val onboardingComplete: Boolean) : AppStartupState
    data class Failed(val message: String) : AppStartupState
}

/**
 * Gates the UI on the two things it needs before showing any real screen: a bootstrapped
 * backend session (SessionRepository.ensureSession — see its doc for why this exists
 * instead of a login screen in this pass) and whether onboarding has been completed.
 */
@HiltViewModel
class AppStartupViewModel @Inject constructor(
    private val sessionRepository: SessionRepository,
    private val appPreferences: AppPreferences,
) : ViewModel() {

    private val _state = MutableStateFlow<AppStartupState>(AppStartupState.Loading)
    val state: StateFlow<AppStartupState> = _state.asStateFlow()

    init {
        start()
    }

    fun retry() {
        _state.value = AppStartupState.Loading
        start()
    }

    private fun start() {
        viewModelScope.launch {
            try {
                sessionRepository.ensureSession()
                val onboardingComplete = appPreferences.onboardingComplete.first()
                _state.value = AppStartupState.Ready(onboardingComplete)
            } catch (t: Throwable) {
                _state.value = AppStartupState.Failed(t.message ?: "Couldn't start ZARVIS. Check your connection and try again.")
            }
        }
    }
}
