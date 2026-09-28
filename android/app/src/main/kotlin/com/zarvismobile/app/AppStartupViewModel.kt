package com.zarvismobile.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.data.local.prefs.AppPreferences
import com.zarvismobile.data.remote.SessionEvents
import com.zarvismobile.data.repository.SessionExpiredException
import com.zarvismobile.data.repository.SessionRepository
import com.zarvismobile.data.repository.SessionState
import com.zarvismobile.feature.settings.describeAuthError
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import retrofit2.HttpException

sealed interface AppStartupState {
    data object Loading : AppStartupState
    data class Ready(val onboardingComplete: Boolean) : AppStartupState
    data class Failed(val message: String) : AppStartupState

    /** The server ended the session: the user chooses — never an automatic new account. */
    data class SessionExpired(
        val lastEmail: String?,
        val wasGuest: Boolean,
        val busy: Boolean = false,
        val error: String? = null,
    ) : AppStartupState
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

    init {
        start()
        // A session can also end mid-use (TokenAuthenticator marks it); react immediately.
        viewModelScope.launch {
            SessionEvents.expired.collect { code ->
                if (code != null) showExpired()
            }
        }
    }

    fun retry() {
        _state.value = AppStartupState.Loading
        start()
    }

    /** Explicit choice after expiry: a brand-new, empty guest account. */
    fun startNewGuest() = sessionAction { sessionRepository.startGuestSession() }

    fun signIn(email: String, password: String) = sessionAction { sessionRepository.signIn(email, password) }

    private fun sessionAction(block: suspend () -> Unit) {
        val current = _state.value as? AppStartupState.SessionExpired ?: return
        _state.value = current.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                block()
                appPreferences.setConversationId(null)
                _state.value = AppStartupState.Ready(onboardingComplete = appPreferences.onboardingComplete.first())
            } catch (t: CancellationException) {
                throw t
            } catch (e: HttpException) {
                _state.value = current.copy(busy = false, error = describeAuthError(e))
            } catch (t: Throwable) {
                _state.value = current.copy(busy = false, error = "Couldn't reach ZARVIS. Check your connection and try again.")
            }
        }
    }

    private fun showExpired() {
        val expired = sessionRepository.refreshState() as? SessionState.Expired ?: return
        _state.value = AppStartupState.SessionExpired(expired.lastEmail, expired.wasGuest)
    }

    private fun start() {
        viewModelScope.launch {
            try {
                sessionRepository.ensureSession()
                _state.value = AppStartupState.Ready(onboardingComplete = appPreferences.onboardingComplete.first())
            } catch (e: SessionExpiredException) {
                showExpired()
            } catch (t: CancellationException) {
                throw t
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
