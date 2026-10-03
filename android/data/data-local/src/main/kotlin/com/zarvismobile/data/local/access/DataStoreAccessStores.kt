package com.zarvismobile.data.local.access

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.zarvismobile.domain.access.AccessSnapshotStore
import com.zarvismobile.domain.access.PendingAction
import com.zarvismobile.domain.access.PendingActionStore
import com.zarvismobile.domain.entity.PermissionType
import java.time.Instant
import kotlinx.coroutines.flow.first

private val Context.accessDataStore by preferencesDataStore(name = "zarvis_access")

private object AccessKeys {
    val SNAPSHOT = stringPreferencesKey("last_observed_permissions")
    val PENDING_ID = stringPreferencesKey("pending_id")
    val PENDING_UTTERANCE = stringPreferencesKey("pending_utterance")
    val PENDING_SKILL = stringPreferencesKey("pending_skill")
    val PENDING_STAGE = stringPreferencesKey("pending_stage")
    val PENDING_CREATED = longPreferencesKey("pending_created_at")
}

/**
 * Last *observed* grant state per permission, used only to notice a revocation between app
 * visits. It is never used to authorize anything — every authorization re-reads Android.
 */
class DataStoreAccessSnapshotStore(private val context: Context) : AccessSnapshotStore {
    override suspend fun load(): Map<PermissionType, Boolean> {
        val raw = context.accessDataStore.data.first()[AccessKeys.SNAPSHOT] ?: return emptyMap()
        return raw.split(',').mapNotNull { entry ->
            val (name, value) = entry.split('=').takeIf { it.size == 2 } ?: return@mapNotNull null
            val permission = runCatching { PermissionType.valueOf(name) }.getOrNull() ?: return@mapNotNull null
            permission to (value == "1")
        }.toMap()
    }

    override suspend fun save(snapshot: Map<PermissionType, Boolean>) {
        context.accessDataStore.edit { prefs ->
            prefs[AccessKeys.SNAPSHOT] = snapshot.entries.joinToString(",") { "${it.key.name}=${if (it.value) 1 else 0}" }
        }
    }
}

/** Survives process death so an interrupted permission/confirmation step can be offered again. */
class DataStorePendingActionStore(private val context: Context) : PendingActionStore {
    override suspend fun save(action: PendingAction) {
        context.accessDataStore.edit { prefs ->
            prefs[AccessKeys.PENDING_ID] = action.id
            prefs[AccessKeys.PENDING_UTTERANCE] = action.utterance
            prefs[AccessKeys.PENDING_SKILL] = action.skillId
            prefs[AccessKeys.PENDING_STAGE] = action.stage.name
            prefs[AccessKeys.PENDING_CREATED] = action.createdAt.toEpochMilli()
        }
    }

    override suspend fun load(): PendingAction? {
        val prefs = context.accessDataStore.data.first()
        val id = prefs[AccessKeys.PENDING_ID] ?: return null
        return PendingAction(
            id = id,
            utterance = prefs[AccessKeys.PENDING_UTTERANCE] ?: return null,
            skillId = prefs[AccessKeys.PENDING_SKILL] ?: return null,
            stage = runCatching { PendingAction.Stage.valueOf(prefs[AccessKeys.PENDING_STAGE].orEmpty()) }.getOrNull() ?: return null,
            createdAt = Instant.ofEpochMilli(prefs[AccessKeys.PENDING_CREATED] ?: return null),
        )
    }

    override suspend fun clear() {
        context.accessDataStore.edit { prefs ->
            prefs.remove(AccessKeys.PENDING_ID)
            prefs.remove(AccessKeys.PENDING_UTTERANCE)
            prefs.remove(AccessKeys.PENDING_SKILL)
            prefs.remove(AccessKeys.PENDING_STAGE)
            prefs.remove(AccessKeys.PENDING_CREATED)
        }
    }
}
