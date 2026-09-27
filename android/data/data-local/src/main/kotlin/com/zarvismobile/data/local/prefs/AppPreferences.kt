package com.zarvismobile.data.local.prefs

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "zarvis_prefs")

private object Keys {
    val ONBOARDING_COMPLETE = booleanPreferencesKey("onboarding_complete")
    val LOCALE = stringPreferencesKey("locale")
    val DARK_THEME = booleanPreferencesKey("dark_theme_override")
    val TTS_VOICE = stringPreferencesKey("tts_voice")
}

/** Local app preferences only. No backend/API behavior is changed here. */
class AppPreferences(private val context: Context) {
    val onboardingComplete: Flow<Boolean> =
        context.dataStore.data.map { it[Keys.ONBOARDING_COMPLETE] ?: false }

    val locale: Flow<String> =
        context.dataStore.data.map { it[Keys.LOCALE] ?: "en" }

    val darkTheme: Flow<Boolean> =
        context.dataStore.data.map { it[Keys.DARK_THEME] ?: false }

    val ttsVoice: Flow<String> =
        context.dataStore.data.map { it[Keys.TTS_VOICE] ?: "Kore" }

    suspend fun setOnboardingComplete(complete: Boolean) {
        context.dataStore.edit { it[Keys.ONBOARDING_COMPLETE] = complete }
    }

    suspend fun setLocale(locale: String) {
        context.dataStore.edit { it[Keys.LOCALE] = locale }
    }

    suspend fun setDarkTheme(enabled: Boolean) {
        context.dataStore.edit { it[Keys.DARK_THEME] = enabled }
    }

    suspend fun setTtsVoice(voice: String) {
        context.dataStore.edit { it[Keys.TTS_VOICE] = voice }
    }
}
