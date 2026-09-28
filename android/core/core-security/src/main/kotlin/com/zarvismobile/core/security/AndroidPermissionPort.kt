package com.zarvismobile.core.security

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.zarvismobile.domain.access.AccessState
import com.zarvismobile.domain.access.DeviceAccessPort
import com.zarvismobile.domain.access.satisfied
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.port.PermissionPort

/** The Android runtime permission behind each [PermissionType], or null when none exists on this API level. */
fun PermissionType.androidPermission(sdkInt: Int = Build.VERSION.SDK_INT): String? = when (this) {
    // POST_NOTIFICATIONS only exists from Android 13 (API 33). On 8–12 there is no runtime
    // permission — notifications are governed by the app-level notification switch.
    PermissionType.NOTIFICATIONS -> if (sdkInt >= 33) Manifest.permission.POST_NOTIFICATIONS else null
    PermissionType.CONTACTS -> Manifest.permission.READ_CONTACTS
    PermissionType.PHONE_CALL -> Manifest.permission.CALL_PHONE
    PermissionType.CAMERA -> Manifest.permission.CAMERA
    PermissionType.MICROPHONE -> Manifest.permission.RECORD_AUDIO
    PermissionType.STORAGE -> null // scoped storage / system pickers — no runtime permission
    PermissionType.CALENDAR -> Manifest.permission.READ_CALENDAR
    PermissionType.LOCATION -> Manifest.permission.ACCESS_COARSE_LOCATION
}

/**
 * Remembers which permissions ZARVIS has asked for on this install. Android does not expose
 * "never asked" vs "denied permanently" directly; combined with
 * shouldShowRequestPermissionRationale this distinguishes them. It is a UX hint only — it is
 * never used to decide whether something is *granted*.
 */
class PermissionRequestLog(context: Context) {
    private val prefs = context.getSharedPreferences("zarvis_permission_requests", Context.MODE_PRIVATE)

    fun markRequested(permission: String) {
        prefs.edit().putBoolean(permission, true).apply()
    }

    fun wasRequested(permission: String): Boolean = prefs.getBoolean(permission, false)
}

/**
 * Reads the live permission state from Android every time (blueprint §10: Android is the
 * security authority; never trust a stored flag).
 */
class AndroidDeviceAccessPort(
    private val context: Context,
    private val requestLog: PermissionRequestLog,
    private val currentActivity: () -> Activity?,
) : DeviceAccessPort {

    override suspend fun state(permission: PermissionType): AccessState {
        val notificationsEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
        val androidPermission = permission.androidPermission()
        if (androidPermission == null) {
            return when (permission) {
                PermissionType.NOTIFICATIONS -> if (notificationsEnabled) AccessState.GRANTED else AccessState.SYSTEM_DISABLED
                else -> AccessState.NOT_REQUIRED
            }
        }
        val granted = ContextCompat.checkSelfPermission(context, androidPermission) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            // Granted POST_NOTIFICATIONS can still be overridden by the app's notification switch.
            return if (permission == PermissionType.NOTIFICATIONS && !notificationsEnabled) AccessState.SYSTEM_DISABLED else AccessState.GRANTED
        }
        if (!requestLog.wasRequested(androidPermission)) return AccessState.NOT_REQUESTED
        val activity = currentActivity() ?: return AccessState.DENIED
        return if (ActivityCompat.shouldShowRequestPermissionRationale(activity, androidPermission)) {
            AccessState.DENIED
        } else {
            AccessState.PERMANENTLY_DENIED
        }
    }
}

/**
 * The ToolPipeline's permission stage: satisfied only when Android reports the permission
 * granted right now (re-checked at execution time and again after confirmation).
 */
class AndroidPermissionPort(private val device: DeviceAccessPort) : PermissionPort {
    override suspend fun isGranted(permission: PermissionType): Boolean = device.state(permission).satisfied()
}
