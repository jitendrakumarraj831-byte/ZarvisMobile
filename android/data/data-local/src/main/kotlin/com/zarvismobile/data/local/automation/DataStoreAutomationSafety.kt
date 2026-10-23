package com.zarvismobile.data.local.automation

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.zarvismobile.domain.policy.AutomationHistory
import com.zarvismobile.domain.policy.AutomationHistoryStore
import com.zarvismobile.domain.policy.AutomationPauseStore
import com.zarvismobile.domain.policy.AutomationRecord
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.automationDataStore by preferencesDataStore(name = "zarvis_automation")

private object AutomationKeys {
    val PAUSED = booleanPreferencesKey("phone_actions_paused")
    val HISTORY = stringPreferencesKey("phone_action_history")
}

/**
 * Settings › Phone action safety, on this phone only: the "pause all phone actions" switch and the history of phone actions
 * (AUTOMATION_SECURITY_POLICY.md). Nothing here is uploaded. A read error is not swallowed: the pipeline treats an unreadable
 * pause setting as paused, so a broken store can stop phone actions but never let one through.
 */
class DataStoreAutomationSafety(private val context: Context) : AutomationPauseStore, AutomationHistoryStore {

    override val paused: Flow<Boolean> = context.automationDataStore.data.map { it[AutomationKeys.PAUSED] ?: false }

    override suspend fun setPaused(paused: Boolean) {
        context.automationDataStore.edit { it[AutomationKeys.PAUSED] = paused }
    }

    override val entries: Flow<List<AutomationRecord>> =
        context.automationDataStore.data.map { AutomationHistory.decode(it[AutomationKeys.HISTORY]) }

    override suspend fun record(entry: AutomationRecord) {
        context.automationDataStore.edit { prefs ->
            val history = AutomationHistory.decode(prefs[AutomationKeys.HISTORY])
            prefs[AutomationKeys.HISTORY] = AutomationHistory.encode(AutomationHistory.append(history, entry))
        }
    }

    override suspend fun clear() {
        context.automationDataStore.edit { it.remove(AutomationKeys.HISTORY) }
    }
}
