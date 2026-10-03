package com.zarvismobile.app.access

import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import com.zarvismobile.domain.skill.GlobalAction
import com.zarvismobile.domain.skill.GlobalActionResult
import com.zarvismobile.domain.skill.ScreenAccessPort
import com.zarvismobile.domain.skill.ScreenRead
import com.zarvismobile.domain.skill.ScreenTarget
import com.zarvismobile.domain.skill.TapPlan
import com.zarvismobile.domain.skill.TapResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * ZARVIS's accessibility service (capabilities: accessibility, screen_interaction). It does
 * nothing on its own: it only runs the single action the user asked for and confirmed through
 * the ToolPipeline, via [AndroidScreenAccessPort]. It observes window events solely to know
 * which app is in front; it never records or uploads screen content.
 */
class ZarvisAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        connected = this
        Log.i(TAG, "ZARVIS_EVIDENCE accessibility connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    override fun onUnbind(intent: Intent?): Boolean {
        if (connected === this) connected = null
        Log.i(TAG, "ZARVIS_EVIDENCE accessibility disconnected")
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        if (connected === this) connected = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "ZarvisAccessibility"

        @Volatile
        internal var connected: ZarvisAccessibilityService? = null
            private set

        fun component(context: Context) = ComponentName(context, ZarvisAccessibilityService::class.java)
    }
}

class AndroidScreenAccessPort(private val context: Context) : ScreenAccessPort {

    private val service: ZarvisAccessibilityService? get() = ZarvisAccessibilityService.connected

    override fun serviceConnected(): Boolean = service != null

    override fun supports(action: GlobalAction): Boolean = Build.VERSION.SDK_INT >= action.minSdk

    override suspend fun performGlobal(action: GlobalAction): GlobalActionResult = withContext(Dispatchers.Main) {
        val svc = service ?: return@withContext GlobalActionResult(false, null, null)
        val code = when (action) {
            GlobalAction.BACK -> AccessibilityService.GLOBAL_ACTION_BACK
            GlobalAction.HOME -> AccessibilityService.GLOBAL_ACTION_HOME
            GlobalAction.RECENTS -> AccessibilityService.GLOBAL_ACTION_RECENTS
            GlobalAction.NOTIFICATIONS -> AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS
            GlobalAction.QUICK_SETTINGS -> AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS
            GlobalAction.LOCK_SCREEN -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN else return@withContext GlobalActionResult(false, null, null)
        }
        val accepted = svc.performGlobalAction(code)
        if (!accepted) return@withContext GlobalActionResult(false, null, null)
        delay(SETTLE_MS)
        // Read back what Android shows now; only these outcomes have a reliable expected value.
        when (action) {
            GlobalAction.HOME -> GlobalActionResult(true, activePackage(svc), defaultLauncher())
            GlobalAction.NOTIFICATIONS, GlobalAction.QUICK_SETTINGS -> GlobalActionResult(true, activePackage(svc), SYSTEM_UI)
            GlobalAction.LOCK_SCREEN -> GlobalActionResult(true, if (screenLockedOrOff()) LOCKED else UNLOCKED, LOCKED)
            GlobalAction.BACK, GlobalAction.RECENTS -> GlobalActionResult(true, activePackage(svc), null)
        }.also { Log.i(TAG, "ZARVIS_EVIDENCE accessibility global=$action $it") }
    }

    override suspend fun foregroundTarget(): ScreenTarget? = withContext(Dispatchers.Main) {
        val svc = service ?: return@withContext null
        targetWindow(svc)?.let { (window, pkg) -> ScreenTarget(pkg, label(pkg, window)) }
    }

    override suspend fun readScreen(expectedPackage: String): ScreenRead = withContext(Dispatchers.Main) {
        val svc = service ?: return@withContext ScreenRead.Unavailable("ZARVIS's accessibility service isn't running.", userActionRequired = true)
        val (window, pkg) = targetWindow(svc)
            ?: return@withContext ScreenRead.Unavailable("No app is visible behind ZARVIS.", userActionRequired = true)
        if (pkg != expectedPackage) {
            return@withContext ScreenRead.Unavailable("The app in front changed, so nothing was read. Ask again.", userActionRequired = false)
        }
        val roots = appRoots(svc, pkg)
        if (roots.isEmpty()) return@withContext ScreenRead.Unavailable("Android didn't share this screen's content.", userActionRequired = false)
        var skipped = 0
        val lines = mutableListOf<String>()
        for (root in roots) walk(root) { node ->
            if (node.isPassword) {
                skipped++
                false // never read a password field or anything inside it
            } else {
                if (node.isVisibleToUser) {
                    val text = (node.text ?: node.contentDescription)?.toString()?.trim()?.replace(Regex("\\s+"), " ")
                    if (!text.isNullOrEmpty() && lines.lastOrNull() != text) lines += text
                }
                true
            }
        }
        Log.i(TAG, "ZARVIS_EVIDENCE screen_read package=$pkg lines=${lines.size} skippedPassword=$skipped")
        ScreenRead.Text(ScreenTarget(pkg, label(pkg, window)), lines, skipped)
    }

    override suspend fun planTap(label: String): TapPlan = withContext(Dispatchers.Main) {
        val svc = service ?: return@withContext TapPlan.Unavailable("ZARVIS's accessibility service isn't running.", userActionRequired = true)
        val (window, pkg) = targetWindow(svc) ?: return@withContext TapPlan.Unavailable("No app is visible behind ZARVIS.", userActionRequired = true)
        val matches = clickableMatches(appRoots(svc, pkg), label)
        when (matches.size) {
            1 -> TapPlan.Ready(ScreenTarget(pkg, label(pkg, window)), matches.single().second)
            0 -> TapPlan.Unavailable("I can't find a button labelled \"$label\" on the ${label(pkg, window)} screen.", userActionRequired = false)
            else -> TapPlan.Unavailable("There are ${matches.size} buttons labelled \"$label\" on screen, so I won't guess which one.", userActionRequired = false)
        }
    }

    override suspend fun tap(label: String, expectedPackage: String): TapResult = withContext(Dispatchers.Main) {
        val svc = service ?: return@withContext TapResult(false, false, "ZARVIS's accessibility service isn't running.")
        val (_, pkg) = targetWindow(svc) ?: return@withContext TapResult(false, false, "No app is visible behind ZARVIS.")
        if (pkg != expectedPackage) return@withContext TapResult(false, false, "The app in front changed, so nothing was tapped.")
        val match = clickableMatches(appRoots(svc, pkg), label).singleOrNull()
            ?: return@withContext TapResult(false, false, "The button \"$label\" is no longer on screen exactly once, so nothing was tapped.")
        val before = signature(appRoots(svc, pkg))
        val accepted = match.first.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        if (!accepted) return@withContext TapResult(false, false, "Android didn't accept the tap on \"$label\".")
        delay(SETTLE_MS)
        val after = signature(appRoots(svc, pkg))
        val changed = after != before
        Log.i(TAG, "ZARVIS_EVIDENCE screen_tap package=$pkg accepted=true changed=$changed")
        TapResult(accepted = true, screenChanged = changed)
    }

    /** The top-most application window that isn't ZARVIS itself. */
    private fun targetWindow(svc: AccessibilityService): Pair<AccessibilityWindowInfo, String>? =
        svc.windows
            .filter { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
            .sortedByDescending { it.layer }
            .firstNotNullOfOrNull { window ->
                val pkg = window.root?.packageName?.toString() ?: return@firstNotNullOfOrNull null
                if (pkg == context.packageName) null else window to pkg
            }

    /**
     * Every window of the app in front, top-most first. Apps often show a popup, banner or
     * dialog in a separate window over their main screen (e.g. Clock's privacy notice on
     * Android 14); reading only the top window would miss the screen the user sees under it.
     */
    private fun appRoots(svc: AccessibilityService, pkg: String): List<AccessibilityNodeInfo> =
        svc.windows
            .filter { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
            .sortedByDescending { it.layer }
            .mapNotNull { window -> window.root?.takeIf { it.packageName?.toString() == pkg } }

    /** (clickable node, the label as shown) for each distinct element exactly matching [label], across the app's windows. */
    private fun clickableMatches(roots: List<AccessibilityNodeInfo>, label: String): List<Pair<AccessibilityNodeInfo, String>> {
        val wanted = normalize(label)
        val found = mutableListOf<Pair<AccessibilityNodeInfo, String>>()
        for (root in roots) walk(root) { node ->
            if (node.isPassword) return@walk false
            val shown = (node.text ?: node.contentDescription)?.toString()
            if (node.isVisibleToUser && shown != null && normalize(shown) == wanted) {
                clickableSelfOrAncestor(node)?.let { found += it to shown.trim() }
            }
            true
        }
        return found.distinctBy { it.first }
    }

    private fun clickableSelfOrAncestor(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node
        repeat(MAX_ANCESTORS) {
            val n = current ?: return null
            if (n.isClickable && n.isEnabled) return n
            current = n.parent
        }
        return null
    }

    /** Depth-first walk; [visit] returns false to skip a node's children. Bounded for safety. */
    private fun walk(root: AccessibilityNodeInfo, visit: (AccessibilityNodeInfo) -> Boolean) {
        val stack = ArrayDeque<Pair<AccessibilityNodeInfo, Int>>()
        stack.addLast(root to 0)
        var visited = 0
        while (stack.isNotEmpty() && visited < MAX_NODES) {
            val (node, depth) = stack.removeLast()
            visited++
            if (!visit(node) || depth >= MAX_DEPTH) continue
            for (i in node.childCount - 1 downTo 0) node.getChild(i)?.let { stack.addLast(it to depth + 1) }
        }
    }

    private fun signature(roots: List<AccessibilityNodeInfo>): String {
        val parts = StringBuilder()
        for (root in roots) walk(root) { node ->
            if (node.isPassword) return@walk false
            parts.append(node.className).append('|').append(node.text).append('|').append(node.isSelected).append('|').append(node.isChecked).append(';')
            true
        }
        return parts.toString()
    }

    private fun normalize(text: String) = text.trim().replace(Regex("\\s+"), " ").lowercase()

    private fun activePackage(svc: AccessibilityService): String? =
        svc.windows.firstOrNull { it.isActive }?.root?.packageName?.toString() ?: svc.rootInActiveWindow?.packageName?.toString()

    private fun defaultLauncher(): String? =
        context.packageManager.resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY)
            ?.activityInfo?.packageName

    private fun screenLockedOrOff(): Boolean {
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        return !power.isInteractive || keyguard.isKeyguardLocked
    }

    private fun label(pkg: String, window: AccessibilityWindowInfo): String {
        val pm = context.packageManager
        return try {
            pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
        } catch (e: PackageManager.NameNotFoundException) {
            window.title?.toString()?.takeIf { it.isNotBlank() } ?: pkg
        }
    }

    private companion object {
        const val TAG = "ZarvisAccessibility"
        const val SETTLE_MS = 1_000L
        const val MAX_NODES = 600
        const val MAX_DEPTH = 40
        const val MAX_ANCESTORS = 6
        const val SYSTEM_UI = "com.android.systemui"
        const val LOCKED = "screen locked or off"
        const val UNLOCKED = "screen on and unlocked"
    }
}
