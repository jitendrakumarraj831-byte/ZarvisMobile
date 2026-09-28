package com.zarvismobile.data.local.access

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import com.zarvismobile.domain.notification.LockScreenBehavior
import com.zarvismobile.domain.notification.NotificationMode
import com.zarvismobile.domain.notification.NotificationPrivacySettings
import com.zarvismobile.domain.notification.QuietHours
import com.zarvismobile.domain.skill.NotificationSettingsPort
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.notificationDataStore by preferencesDataStore(name = "zarvis_notification_privacy")

private object NotificationKeys {
    val MODE = stringPreferencesKey("mode")
    val SPEAK = booleanPreferencesKey("speak_enabled")
    val QUIET_ON = booleanPreferencesKey("quiet_enabled")
    val QUIET_START = intPreferencesKey("quiet_start_minute")
    val QUIET_END = intPreferencesKey("quiet_end_minute")
    val LOCK = stringPreferencesKey("lock_screen")
    val HEADPHONES = booleanPreferencesKey("headphones_only")
    val SENSITIVE = booleanPreferencesKey("include_sensitive")
    val EXCLUDED = stringSetPreferencesKey("excluded_packages")
}

/** Blueprint §12 notification privacy settings, persisted on the device only. */
class DataStoreNotificationSettings(private val context: Context) : NotificationSettingsPort {

    val settings: Flow<NotificationPrivacySettings> = context.notificationDataStore.data.map(::read)

    override suspend fun current(): NotificationPrivacySettings = settings.first()

    override suspend fun update(transform: (NotificationPrivacySettings) -> NotificationPrivacySettings) {
        context.notificationDataStore.edit { prefs ->
            val next = transform(read(prefs))
            prefs[NotificationKeys.MODE] = next.mode.name
            prefs[NotificationKeys.SPEAK] = next.speakEnabled
            prefs[NotificationKeys.QUIET_ON] = next.quietHours.enabled
            prefs[NotificationKeys.QUIET_START] = next.quietHours.startMinute
            prefs[NotificationKeys.QUIET_END] = next.quietHours.endMinute
            prefs[NotificationKeys.LOCK] = next.lockScreen.name
            prefs[NotificationKeys.HEADPHONES] = next.headphonesOnly
            prefs[NotificationKeys.SENSITIVE] = next.includeSensitive
            prefs[NotificationKeys.EXCLUDED] = next.excludedPackages
        }
    }

    private fun read(prefs: Preferences): NotificationPrivacySettings {
        val defaults = NotificationPrivacySettings()
        return NotificationPrivacySettings(
            mode = prefs[NotificationKeys.MODE]?.let { runCatching { NotificationMode.valueOf(it) }.getOrNull() } ?: defaults.mode,
            speakEnabled = prefs[NotificationKeys.SPEAK] ?: defaults.speakEnabled,
            quietHours = QuietHours(
                enabled = prefs[NotificationKeys.QUIET_ON] ?: defaults.quietHours.enabled,
                startMinute = prefs[NotificationKeys.QUIET_START]?.takeIf { it in 0 until QuietHours.MINUTES_PER_DAY } ?: defaults.quietHours.startMinute,
                endMinute = prefs[NotificationKeys.QUIET_END]?.takeIf { it in 0 until QuietHours.MINUTES_PER_DAY } ?: defaults.quietHours.endMinute,
            ),
            lockScreen = prefs[NotificationKeys.LOCK]?.let { runCatching { LockScreenBehavior.valueOf(it) }.getOrNull() } ?: defaults.lockScreen,
            headphonesOnly = prefs[NotificationKeys.HEADPHONES] ?: defaults.headphonesOnly,
            includeSensitive = prefs[NotificationKeys.SENSITIVE] ?: defaults.includeSensitive,
            excludedPackages = prefs[NotificationKeys.EXCLUDED] ?: defaults.excludedPackages,
        )
    }
}
