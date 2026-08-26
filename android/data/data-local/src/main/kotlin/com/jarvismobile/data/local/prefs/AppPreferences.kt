package com.jarvismobile.data.local.prefs

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "jarvis_prefs")

private object Keys {
    val ONBOARDING_COMPLETE = booleanPreferencesKey("onboarding_complete")
    val LOCALE = stringPreferencesKey("locale")
}

/**
 * Non-sensitive local preferences (onboarding state, language). See MASTER_SPEC.md §16.
 * There is no theme-override preference: the app follows the system dark/light setting
 * (`JarvisTheme` in core-ui), matching MASTER_SPEC.md §22 — "Support: dark theme, light
 * theme" is satisfied by following the OS; an explicit in-app override is not specified.
 */
class AppPreferences(private val context: Context) {
    val onboardingComplete: Flow<Boolean> =
        context.dataStore.data.map { it[Keys.ONBOARDING_COMPLETE] ?: false }

    val locale: Flow<String> =
        context.dataStore.data.map { it[Keys.LOCALE] ?: "en" }

    suspend fun setOnboardingComplete(complete: Boolean) {
        context.dataStore.edit { it[Keys.ONBOARDING_COMPLETE] = complete }
    }

    suspend fun setLocale(locale: String) {
        context.dataStore.edit { it[Keys.LOCALE] = locale }
    }
}
