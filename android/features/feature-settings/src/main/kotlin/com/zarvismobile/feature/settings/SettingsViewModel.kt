package com.zarvismobile.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zarvismobile.core.security.SecureStorage
import com.zarvismobile.data.local.prefs.AppPreferences
import com.zarvismobile.data.remote.ZarvisApi
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class SettingsUiState(val locale: String = "en")

enum class DeleteAccountStatus { IDLE, IN_PROGRESS, FAILED }

/**
 * Privacy/permission/memory controls — MASTER_SPEC.md §16, §17, §27. What's real in this
 * pass: language preference, local sign-out, and account deletion (DELETE /api/v1/account —
 * cascades server-side to tasks/usage/permissions/the account itself, see backend/src/api/
 * routes/account.ts). Server-side memory view/delete-single-item/export have no dedicated
 * endpoints yet — see MASTER_SPEC.md §29. This screen marks those controls as planned rather
 * than faking them.
 */
@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val preferences: AppPreferences,
    private val secureStorage: SecureStorage,
    private val api: ZarvisApi,
) : ViewModel() {

    val uiState: StateFlow<SettingsUiState> = preferences.locale
        .map { SettingsUiState(locale = it) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), SettingsUiState())

    private val _deleteAccountStatus = MutableStateFlow(DeleteAccountStatus.IDLE)
    val deleteAccountStatus: StateFlow<DeleteAccountStatus> = _deleteAccountStatus.asStateFlow()

    fun setLocale(locale: String) {
        viewModelScope.launch { preferences.setLocale(locale) }
    }

    fun clearLocalSession() {
        secureStorage.clear()
    }

    /**
     * Deletes the backend account (and everything scoped to it), then clears the local
     * session so the next launch bootstraps a fresh guest account — the same self-healing
     * path TokenAuthenticator already relies on (see SessionRepository.ensureSession).
     */
    fun deleteAccount(onDeleted: () -> Unit) {
        viewModelScope.launch {
            _deleteAccountStatus.value = DeleteAccountStatus.IN_PROGRESS
            try {
                api.deleteAccount()
                secureStorage.clear()
                _deleteAccountStatus.value = DeleteAccountStatus.IDLE
                onDeleted()
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _deleteAccountStatus.value = DeleteAccountStatus.FAILED
            }
        }
    }

    fun dismissDeleteAccountError() {
        _deleteAccountStatus.value = DeleteAccountStatus.IDLE
    }
}
