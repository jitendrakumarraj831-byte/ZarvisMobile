package com.zarvismobile.core.security

import android.Manifest
import android.app.AppOpsManager
import android.app.NotificationManager
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.provider.Settings
import com.zarvismobile.domain.access.AccessState
import com.zarvismobile.domain.entity.PermissionType

/** The app's own components that special access is granted to. */
data class SpecialAccessComponents(
    val notificationListener: ComponentName,
    val accessibilityService: ComponentName,
)

/**
 * Reads the live state of each special access straight from Android on every call:
 * - notification access: the enabled-listener list NotificationManager keeps;
 * - accessibility: the enabled-services list in Settings.Secure;
 * - usage access: the GET_USAGE_STATS app-op;
 * - assistant: RoleManager (Android 10+) or the "assistant" secure setting (Android 8–9).
 */
class SpecialAccessStates(
    private val context: Context,
    private val components: SpecialAccessComponents,
) {
    fun state(permission: PermissionType): AccessState = when (permission) {
        PermissionType.NOTIFICATION_LISTENER -> on(notificationListenerEnabled())
        PermissionType.ACCESSIBILITY_SERVICE -> on(accessibilityServiceEnabled())
        PermissionType.USAGE_ACCESS -> on(usageAccessAllowed())
        PermissionType.ASSISTANT_ROLE -> assistantState()
        else -> error("$permission is not special access")
    }

    private fun on(enabled: Boolean) = if (enabled) AccessState.GRANTED else AccessState.SPECIAL_ACCESS_OFF

    /**
     * Asked of Android on every call. NotificationManagerCompat.getEnabledListenerPackages is not
     * used: it caches the list and keeps the stale copy when the setting is cleared, so a
     * revocation would read as still granted.
     */
    fun notificationListenerEnabled(): Boolean {
        val mine = components.notificationListener
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            val manager = context.getSystemService(NotificationManager::class.java)
            if (manager != null) return manager.isNotificationListenerAccessGranted(mine)
        }
        val enabled = Settings.Secure.getString(context.contentResolver, ENABLED_NOTIFICATION_LISTENERS).orEmpty()
        return enabled.split(':').any { entry ->
            ComponentName.unflattenFromString(entry.trim())?.let { it.packageName == mine.packageName && it.className == mine.className } == true
        }
    }

    fun accessibilityServiceEnabled(): Boolean {
        val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
        val mine = components.accessibilityService
        return enabled.split(':').any { entry ->
            ComponentName.unflattenFromString(entry.trim())?.let { it.packageName == mine.packageName && it.className == mine.className } == true
        }
    }

    @Suppress("DEPRECATION")
    fun usageAccessAllowed(): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        } else {
            appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        }
        return when (mode) {
            AppOpsManager.MODE_ALLOWED -> true
            // MODE_DEFAULT defers to the permission itself (granted through the same Settings page).
            AppOpsManager.MODE_DEFAULT -> context.checkSelfPermission(Manifest.permission.PACKAGE_USAGE_STATS) == PackageManager.PERMISSION_GRANTED
            else -> false
        }
    }

    fun isDefaultAssistant(): Boolean = assistantState() == AccessState.GRANTED

    private fun assistantState(): AccessState {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val roles = context.getSystemService(RoleManager::class.java) ?: return AccessState.UNAVAILABLE
            if (!roles.isRoleAvailable(RoleManager.ROLE_ASSISTANT)) return AccessState.UNAVAILABLE
            return on(roles.isRoleHeld(RoleManager.ROLE_ASSISTANT))
        }
        // Android 8–9 keep the chosen assist component in the "assistant" secure setting.
        return try {
            val current = Settings.Secure.getString(context.contentResolver, "assistant")
            on(current != null && ComponentName.unflattenFromString(current)?.packageName == context.packageName)
        } catch (e: SecurityException) {
            AccessState.UNAVAILABLE
        }
    }

    private companion object {
        /** Settings.Secure key Android keeps the enabled notification listeners in (hidden constant). */
        const val ENABLED_NOTIFICATION_LISTENERS = "enabled_notification_listeners"
    }
}
