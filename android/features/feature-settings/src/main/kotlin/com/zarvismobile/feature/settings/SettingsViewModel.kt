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
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class SettingsUiState(
    val locale: String = "en",
    val darkTheme: Boolean = false,
)

enum class DeleteAccountStatus { IDLE, IN_PROGRESS, FAILED }

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val preferences: AppPreferences,
    private val secureStorage: SecureStorage,
    private val api: ZarvisApi,
) : ViewModel() {

    val uiState: StateFlow<SettingsUiState> = combine(
        preferences.locale,
        preferences.darkTheme,
    ) { locale, darkTheme ->
        SettingsUiState(locale = locale, darkTheme = darkTheme)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), SettingsUiState())

    private val _deleteAccountStatus = MutableStateFlow(DeleteAccountStatus.IDLE)
    val deleteAccountStatus: StateFlow<DeleteAccountStatus> = _deleteAccountStatus.asStateFlow()

    fun setLocale(locale: String) {
        viewModelScope.launch { preferences.setLocale(locale) }
    }

    fun setDarkTheme(enabled: Boolean) {
        viewModelScope.launch { preferences.setDarkTheme(enabled) }
    }

    fun clearLocalSession() {
        secureStorage.clear()
    }

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
}
