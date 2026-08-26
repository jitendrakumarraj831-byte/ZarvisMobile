package com.jarvismobile.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jarvismobile.core.security.SecureStorage
import com.jarvismobile.data.local.prefs.AppPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class SettingsUiState(val locale: String = "en")

/**
 * Privacy/permission/memory controls — MASTER_SPEC.md §16, §17, §27. What's real in this
 * pass: language preference and local sign-out (clears the device session). Server-side
 * memory view/delete/export/account-deletion are architected (backend §17 entities exist)
 * but have no dedicated endpoints yet in this pass — see MASTER_SPEC.md §29. This screen
 * marks those controls as planned rather than faking them.
 */
@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val preferences: AppPreferences,
    private val secureStorage: SecureStorage,
) : ViewModel() {

    val uiState: StateFlow<SettingsUiState> = preferences.locale
        .map { SettingsUiState(locale = it) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), SettingsUiState())

    fun setLocale(locale: String) {
        viewModelScope.launch { preferences.setLocale(locale) }
    }

    fun clearLocalSession() {
        secureStorage.clear()
    }
}
