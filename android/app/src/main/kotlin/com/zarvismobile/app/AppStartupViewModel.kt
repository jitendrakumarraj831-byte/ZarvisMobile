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
                _state.value = AppStartupState.Failed(describeStartupFailure(t))
            }
        }
    }
}

/**
 * Turns a startup exception into something a developer holding the phone can act on.
 *
 * A release build gets the plain user-facing sentence. A debug build also names the backend
 * it actually tried — the failure is almost always "this APK was built pointing somewhere
 * this phone can't reach", and the base URL is compiled in, so without printing it there is
 * no way to tell from the device which backend was configured. Two specific
 * misconfigurations get a direct instruction instead of a stack-trace message:
 *  - `10.0.2.2` on a physical phone: the emulator's alias for the build machine's loopback,
 *    which has no route from a real device.
 *  - a cleartext-policy rejection: HTTP to a host the network security config doesn't
 *    exempt (`app/build.gradle.kts` generates that exemption from the dev host).
 */
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
            "10.0.2.2 is the Android emulator's alias for your computer — a physical phone has no route " +
                "to it. Rebuild with -Pzarvis.devApiHost=<your computer's LAN IP> (see DEVELOPMENT.md)."
        reason.contains("CLEARTEXT", ignoreCase = true) ->
            "Plain HTTP to this host is blocked by the network security config. Debug builds exempt only " +
                "the dev host they were built with (see DEVELOPMENT.md)."
        else ->
            "Check that the backend is running (cd backend && npm run dev), that this phone is on the same " +
                "network, and that the host firewall allows inbound connections on that port."
    }
    return "Couldn't reach the ZARVIS backend at $baseUrl\n\n$reason\n\n$hint"
}
