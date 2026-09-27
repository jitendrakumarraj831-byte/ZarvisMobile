package com.zarvismobile.app

import android.Manifest
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.port.RuntimePermissionBroker
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Bridges a skill or microphone request to the activity permission launcher.
 * MainActivity registers [launch] before the first user action.
 */
object ActivityRuntimePermissionBroker : RuntimePermissionBroker {
    @Volatile var launch: ((Array<String>) -> Unit)? = null
    private var pending: CompletableDeferred<Map<String, Boolean>>? = null

    fun deliver(result: Map<String, Boolean>) {
        pending?.complete(result)
        pending = null
    }

    override suspend fun ensure(permissions: List<PermissionType>): Boolean {
        val names = permissions.mapNotNull { it.toAndroidPermission() }.distinct()
        if (names.isEmpty()) return true
        val launcher = launch ?: return false
        val deferred = CompletableDeferred<Map<String, Boolean>>()
        pending = deferred
        withContext(Dispatchers.Main) { launcher(names.toTypedArray()) }
        val result = withTimeoutOrNull(60_000) { deferred.await() } ?: return false
        return names.all { result[it] == true }
    }

    private fun PermissionType.toAndroidPermission(): String? = when (this) {
        PermissionType.NOTIFICATIONS -> Manifest.permission.POST_NOTIFICATIONS
        PermissionType.CONTACTS -> Manifest.permission.READ_CONTACTS
        PermissionType.PHONE_CALL -> Manifest.permission.CALL_PHONE
        PermissionType.CAMERA -> Manifest.permission.CAMERA
        PermissionType.MICROPHONE -> Manifest.permission.RECORD_AUDIO
        PermissionType.STORAGE -> null
        PermissionType.CALENDAR -> Manifest.permission.READ_CALENDAR
        PermissionType.LOCATION -> Manifest.permission.ACCESS_COARSE_LOCATION
    }
}
