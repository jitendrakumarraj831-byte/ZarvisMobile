package com.jarvismobile.core.security

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.jarvismobile.domain.entity.PermissionType
import com.jarvismobile.domain.port.PermissionPort

/**
 * Real, on-device implementation of [PermissionPort] — see MASTER_SPEC.md §16 and
 * ARCHITECTURE.md "Why a pure-Kotlin domain module": this is the Android-side binding, a
 * fast-fail UX convenience. The backend's own [PermissionPort] implementation is the actual
 * security boundary for anything server-executed (SECURITY.md).
 */
class AndroidPermissionPort(private val context: Context) : PermissionPort {
    override suspend fun isGranted(permission: PermissionType): Boolean {
        val androidPermission = permission.toAndroidPermission() ?: return true
        return ContextCompat.checkSelfPermission(context, androidPermission) == PackageManager.PERMISSION_GRANTED
    }

    private fun PermissionType.toAndroidPermission(): String? = when (this) {
        PermissionType.NOTIFICATIONS -> Manifest.permission.POST_NOTIFICATIONS
        PermissionType.CONTACTS -> Manifest.permission.READ_CONTACTS
        PermissionType.PHONE_CALL -> Manifest.permission.CALL_PHONE
        PermissionType.CAMERA -> Manifest.permission.CAMERA
        PermissionType.MICROPHONE -> Manifest.permission.RECORD_AUDIO
        PermissionType.STORAGE -> null // scoped storage — no runtime permission needed for app-private files
        PermissionType.CALENDAR -> Manifest.permission.READ_CALENDAR
        PermissionType.LOCATION -> Manifest.permission.ACCESS_COARSE_LOCATION
    }
}
