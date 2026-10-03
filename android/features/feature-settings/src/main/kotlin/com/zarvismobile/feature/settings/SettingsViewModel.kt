package com.zarvismobile.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.data.local.prefs.AppPreferences
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.repository.SessionRepository
import com.zarvismobile.data.repository.SessionState
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import retrofit2.HttpException

data class SettingsUiState(
    val locale: String = "en",
    val darkTheme: Boolean = false,
    val ttsVoice: String = "Kore",
    val autoSpeak: Boolean = false,
)

enum class DeleteAccountStatus { IDLE, IN_PROGRESS, FAILED }

data class AccountFormState(val busy: Boolean = false, val error: String? = null, val info: String? = null)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val preferences: AppPreferences,
    private val sessionRepository: SessionRepository,
    private val api: ZarvisApi,
) : ViewModel() {

    val uiState: StateFlow<SettingsUiState> = combine(
        preferences.locale,
        preferences.darkTheme,
        preferences.ttsVoice,
        preferences.autoSpeak,
    ) { locale, darkTheme, ttsVoice, autoSpeak ->
        SettingsUiState(locale = locale, darkTheme = darkTheme, ttsVoice = ttsVoice, autoSpeak = autoSpeak)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), SettingsUiState())

    val session: StateFlow<SessionState> = sessionRepository.state

    private val _deleteAccountStatus = MutableStateFlow(DeleteAccountStatus.IDLE)
    val deleteAccountStatus: StateFlow<DeleteAccountStatus> = _deleteAccountStatus.asStateFlow()

    private val _accountForm = MutableStateFlow(AccountFormState())
    val accountForm: StateFlow<AccountFormState> = _accountForm.asStateFlow()

    fun setLocale(locale: String) {
        viewModelScope.launch { preferences.setLocale(locale) }
    }

    fun setDarkTheme(enabled: Boolean) {
        viewModelScope.launch { preferences.setDarkTheme(enabled) }
    }

    fun setTtsVoice(voice: String) {
        viewModelScope.launch { preferences.setTtsVoice(voice) }
    }

    fun setAutoSpeak(enabled: Boolean) {
        viewModelScope.launch { preferences.setAutoSpeak(enabled) }
    }

    /** Adds an email/password to this guest account so it can be used on Web and other devices. */
    fun linkEmail(email: String, password: String) = accountAction("Linked. Sign in with this email on the web or another phone to continue with the same account.") {
        sessionRepository.linkEmail(email, password)
    }

    /** Replaces this device's session with the given account. */
    fun signIn(email: String, password: String, onDone: () -> Unit) = accountAction("Signed in.", onDone) {
        sessionRepository.signIn(email, password)
        preferences.setConversationId(null)
    }

    /** Revokes the session on the server and forgets it on this device. */
    fun signOut(onDone: () -> Unit) {
        viewModelScope.launch {
            sessionRepository.signOut()
            preferences.setConversationId(null)
            onDone()
        }
    }

    fun deleteAccount(onDeleted: () -> Unit) {
        viewModelScope.launch {
            _deleteAccountStatus.value = DeleteAccountStatus.IN_PROGRESS
            try {
                api.deleteAccount()
                sessionRepository.clearLocal()
                preferences.setConversationId(null)
                _deleteAccountStatus.value = DeleteAccountStatus.IDLE
                onDeleted()
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _deleteAccountStatus.value = DeleteAccountStatus.FAILED
            }
        }
    }

    private fun accountAction(success: String, onDone: () -> Unit = {}, block: suspend () -> Unit) {
        viewModelScope.launch {
            _accountForm.value = AccountFormState(busy = true)
            try {
                block()
                _accountForm.value = AccountFormState(info = success)
                onDone()
            } catch (t: CancellationException) {
                throw t
            } catch (e: HttpException) {
                _accountForm.value = AccountFormState(error = describeAuthError(e))
            } catch (t: Throwable) {
                _accountForm.value = AccountFormState(error = "Couldn't reach ZARVIS. Check your connection and try again.")
            }
        }
    }
}

fun describeAuthError(e: HttpException): String {
    val body = runCatching { e.response()?.errorBody()?.string() }.getOrNull().orEmpty()
    return when {
        body.contains("email_taken") -> "That email already belongs to another ZARVIS account. Sign in with it instead."
        body.contains("invalid_credentials") -> "Email or password is incorrect."
        body.contains("not_guest") -> "This account already has a sign-in email."
        body.contains("rate_limited") || e.code() == 429 -> "Too many attempts. Wait a few minutes and try again."
        e.code() == 400 -> "Check the email address, and use a password of at least 8 characters."
        else -> "That didn't work (HTTP ${e.code()}). Try again."
    }
}
