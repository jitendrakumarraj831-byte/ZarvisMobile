package com.zarvismobile.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.data.local.prefs.AppPreferences
import com.zarvismobile.data.repository.SessionRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

sealed interface AppStartupState {
    data object Loading : AppStartupState
    data class Ready(val onboardingComplete: Boolean) : AppStartupState
    data class Failed(val message: String) : AppStartupState
}

@HiltViewModel
class AppStartupViewModel @Inject constructor(
    private val sessionRepository: SessionRepository,
    private val appPreferences: AppPreferences,
) : ViewModel() {

    private val _state = MutableStateFlow<AppStartupState>(AppStartupState.Loading)
    val state: StateFlow<AppStartupState> = _state.asStateFlow()

    val darkTheme: StateFlow<Boolean> = appPreferences.darkTheme.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5000),
        false,
    )

    init { start() }

    fun retry() {
        _state.value = AppStartupState.Loading
        start()
    }

    private fun start() {
        viewModelScope.launch {
            try {
                sessionRepository.ensureSession()
                _state.value = AppStartupState.Ready(onboardingComplete = appPreferences.onboardingComplete.first())
            } catch (t: Throwable) {
                _state.value = AppStartupState.Failed(describeStartupFailure(t))
            }
        }
    }
}

internal fun describeStartupFailure(
    error: Throwable,
    baseUrl: String = BuildConfig.API_BASE_URL,
    isDebugBuild: Boolean = BuildConfig.DEBUG,
): String {
    val friendly = "Couldn't start ZARVIS. Check your connection and try again."
    if (!isDebugBuild) return friendly
    val reason = error.message?.takeIf { it.isNotBlank() } ?: error::class.simpleName ?: "unknown error"
    val hint = when {
        baseUrl.contains("10.0.2.2") ->
            "10.0.2.2 is the Android emulator's alias for your computer — a physical phone has no route to it. Rebuild with -Pzarvis.devApiHost=<your computer's LAN IP>."
        reason.contains("CLEARTEXT", ignoreCase = true) ->
            "Plain HTTP to this host is blocked by the network security config. Debug builds exempt only the dev host they were built with."
        else ->
            "Check that the backend is running, that this phone is on the same network, and that the host firewall allows inbound connections on the configured port."
    }
    return "Couldn't reach the ZARVIS backend at $baseUrl\n\n$reason\n\n$hint"
}
