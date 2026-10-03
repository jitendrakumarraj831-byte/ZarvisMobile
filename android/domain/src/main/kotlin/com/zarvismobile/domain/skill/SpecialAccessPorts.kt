package com.zarvismobile.domain.skill

import com.zarvismobile.domain.notification.NotificationPrivacySettings
import com.zarvismobile.domain.notification.NotificationSnapshot

/** The notifications currently shown in the status bar, as ZARVIS's notification listener sees them. */
sealed interface ActiveNotifications {
    data class Available(val items: List<NotificationSnapshot>) : ActiveNotifications

    /** Access is granted but Android has not (re)bound the listener yet — e.g. right after a restart. */
    data object NotConnected : ActiveNotifications
}

fun interface NotificationReaderPort {
    suspend fun active(): ActiveNotifications
}

/** The user's §12 notification privacy settings (ZARVIS Settings > Notifications). */
interface NotificationSettingsPort {
    suspend fun current(): NotificationPrivacySettings
    suspend fun update(transform: (NotificationPrivacySettings) -> NotificationPrivacySettings)
}

data class AppUsage(val packageName: String, val label: String, val foregroundMillis: Long)

sealed interface UsageReport {
    /** Foreground time per app since [sinceEpochMillis] (local midnight), as UsageStatsManager reported it. */
    data class Available(val sinceEpochMillis: Long, val apps: List<AppUsage>) : UsageReport
    data class Unavailable(val reason: String) : UsageReport
}

fun interface UsageStatsPort {
    suspend fun todaySoFar(): UsageReport
}

/** Android accessibility global actions ZARVIS supports (AccessibilityService.performGlobalAction). */
enum class GlobalAction(val spoken: String, val minSdk: Int) {
    BACK("Back", 16),
    HOME("Home", 16),
    RECENTS("Recent apps", 16),
    NOTIFICATIONS("the notification shade", 16),
    QUICK_SETTINGS("Quick settings", 17),
    LOCK_SCREEN("Lock screen", 28),
}

/**
 * [accepted] is what performGlobalAction returned. [observedPackage] is the package of the
 * active window read back afterwards and [expectedPackage] the one this action should lead to
 * (null when Android gives no reliable way to tell); the action is verified only when they match.
 */
data class GlobalActionResult(val accepted: Boolean, val observedPackage: String?, val expectedPackage: String?) {
    val verified: Boolean get() = accepted && expectedPackage != null && observedPackage == expectedPackage
}

/** The app window ZARVIS would read or act on: the top application window that isn't ZARVIS. */
data class ScreenTarget(val packageName: String, val appLabel: String)

sealed interface ScreenRead {
    data class Text(val target: ScreenTarget, val lines: List<String>, val skippedPasswordFields: Int) : ScreenRead
    data class Unavailable(val reason: String, val userActionRequired: Boolean) : ScreenRead
}

sealed interface TapPlan {
    /** Exactly one enabled, clickable element on [target] carries [label]. */
    data class Ready(val target: ScreenTarget, val label: String) : TapPlan
    data class Unavailable(val reason: String, val userActionRequired: Boolean) : TapPlan
}

/** [accepted]: ACTION_CLICK returned true. [screenChanged]: Android reported a window change afterwards. */
data class TapResult(val accepted: Boolean, val screenChanged: Boolean, val reason: String? = null)

/** ZARVIS's AccessibilityService, when the user has turned it on. */
interface ScreenAccessPort {
    /** True while Android has ZARVIS's accessibility service bound and running. */
    fun serviceConnected(): Boolean
    fun supports(action: GlobalAction): Boolean
    suspend fun performGlobal(action: GlobalAction): GlobalActionResult
    suspend fun foregroundTarget(): ScreenTarget?
    suspend fun readScreen(expectedPackage: String): ScreenRead
    suspend fun planTap(label: String): TapPlan
    suspend fun tap(label: String, expectedPackage: String): TapResult
}

/** Whether Android reports ZARVIS as the holder of the Assistant role (RoleManager, API 29+). */
fun interface AssistantRolePort {
    suspend fun isDefaultAssistant(): Boolean
}
