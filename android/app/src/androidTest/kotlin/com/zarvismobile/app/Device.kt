package com.zarvismobile.app

import android.app.UiAutomation
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import com.zarvismobile.app.di.VerificationEntryPoint
import dagger.hilt.android.EntryPointAccessors
import java.io.FileInputStream
import java.util.regex.Pattern

/** Helpers for driving and observing the real Android system from instrumented tests. */
object Device {
    const val APP = "com.zarvismobile.app"
    val sdk: Int get() = Build.VERSION.SDK_INT
    init {
        // By default UiAutomation suppresses every other accessibility service on the device,
        // which would unbind ZARVIS's own service under test.
        Configurator.getInstance().uiAutomationFlags = UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES
    }

    private val automation: UiAutomation
        get() = InstrumentationRegistry.getInstrumentation().getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)

    val ui: UiDevice get() = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    val app: ZarvisApplication get() = ApplicationProvider.getApplicationContext()
    val entry: VerificationEntryPoint get() = EntryPointAccessors.fromApplication(app, VerificationEntryPoint::class.java)

    /**
     * Scrolls ZARVIS's first scrollable node with the accessibility scroll action (what TalkBack
     * uses) instead of a touch gesture, so no system gesture can intercept it. False at the end.
     */
    /**
     * ZARVIS's window roots. The active window is not always ZARVIS's (a heads-up notification or
     * System UI window can hold accessibility focus), so this looks through every window.
     */
    private fun appRoots(): List<android.view.accessibility.AccessibilityNodeInfo> =
        (runCatching { automation.windows.mapNotNull { it.root } }.getOrDefault(emptyList()) +
            listOfNotNull(automation.rootInActiveWindow)).filter { it.packageName?.toString() == APP }

    /**
     * Asks Android to bring ZARVIS's node labelled [text] on screen (ACTION_SHOW_ON_SCREEN, what
     * TalkBack uses when it moves focus to an off-screen item). Unlike UI Automator, this also sees
     * nodes that exist but are scrolled out of view. False when no such node exists yet.
     */
    fun showOnScreen(text: String): Boolean {
        val queue = ArrayDeque(appRoots())
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.text?.toString() == text || node.contentDescription?.toString() == text) {
                return node.performAction(android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.id)
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let(queue::add)
        }
        return false
    }

    fun accessibilityScroll(forward: Boolean): Boolean {
        // Scroll ZARVIS's largest scrollable node — the page itself rather than a nested row.
        val roots = appRoots()
        var best: android.view.accessibility.AccessibilityNodeInfo? = null
        var bestArea = -1L
        val bounds = android.graphics.Rect()
        val queue = ArrayDeque(roots)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.isScrollable && node.packageName?.toString() == APP) {
                node.getBoundsInScreen(bounds)
                val area = bounds.width().toLong() * bounds.height()
                if (area > bestArea) { best = node; bestArea = area }
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let(queue::add)
        }
        val action = if (forward) android.view.accessibility.AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
        else android.view.accessibility.AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        return best?.performAction(action) ?: false
    }

    /** Runs a command as the shell user (what `adb shell` can do), returning its output. */
    fun shell(command: String): String {
        val pfd: ParcelFileDescriptor = automation.executeShellCommand(command)
        return FileInputStream(pfd.fileDescriptor).bufferedReader().use { it.readText() }.also { pfd.close() }
    }

    fun evidence(what: String) {
        val line = "ZARVIS_EVIDENCE sdk=$sdk $what"
        Log.i("ZarvisVerify", line)
        println(line)
    }

    /** Logs what is on screen (package + visible texts) so a CI failure explains itself. */
    fun diagnose(label: String) {
        // The raw window hierarchy (what UI Automator itself sees), reduced to ZARVIS's nodes that
        // carry text, a description or scrolling — robust to nodes changing mid-query.
        val xml = runCatching { java.io.ByteArrayOutputStream().also { ui.dumpWindowHierarchy(it) }.toString("UTF-8") }.getOrDefault("")
        val node = Regex("""<node [^>]*>""")
        fun attr(n: String, a: String) = Regex("""$a="([^"]*)"""").find(n)?.groupValues?.get(1).orEmpty()
        val appNodes = node.findAll(xml).map { it.value }.filter { attr(it, "package") == APP }.toList()
        val shown = appNodes.mapNotNull { n ->
            val t = attr(n, "text").ifEmpty { attr(n, "content-desc") }
            when {
                t.isNotEmpty() -> t
                attr(n, "scrollable") == "true" -> "[scrollable ${attr(n, "class").substringAfterLast('.')}]"
                else -> null
            }
        }
        val line = "ZARVIS_DIAG sdk=$sdk $label front=${ui.currentPackageName} appNodes=${appNodes.size} shown=${shown.take(40)}"
        Log.w("ZarvisVerify", line)
        println(line)
    }

    private var lastDialogCheck = 0L

    /**
     * Some emulator images crash their own System UI ("System UI has stopped", seen on the API 26
     * image) or show "isn't responding" for system apps. That dialog belongs to Android, not to
     * ZARVIS, and covers everything; a user would dismiss it and carry on, so the tests do too
     * (and record that it happened).
     */
    fun dismissSystemErrorDialogs() {
        val now = System.currentTimeMillis()
        if (now - lastDialogCheck < 1_000) return
        lastDialogCheck = now
        val close = ui.findObject(By.res("android", "aerr_close")) ?: ui.findObject(By.res("android", "aerr_wait")) ?: return
        val title = ui.findObject(By.res("android", "alertTitle"))?.text
        // Never hide ZARVIS's own crash or freeze: that is a real failure and must stay visible.
        if (title != null && title.contains("ZARVIS", ignoreCase = true)) {
            diagnose("ZARVIS crash/ANR dialog on screen: $title")
            return
        }
        runCatching { close.click() }
        evidence("environment: dismissed Android system error dialog \"$title\" (not a ZARVIS dialog)")
    }

    fun systemUiRunning(): Boolean = shell("pidof com.android.systemui").isNotBlank()

    /** After Android's System UI crashed and restarted, wait until it (and a window) is back. */
    fun awaitSystemReady(timeoutMs: Long = 20_000) {
        dismissSystemErrorDialogs()
        eventually(timeoutMs, stepMs = 500) { systemUiRunning() && ui.currentPackageName != null }
    }

    /** Waits for [selector] (dismissing Android crash dialogs); on timeout records what was on screen. */
    fun waitFor(selector: BySelector, timeoutMs: Long = 15_000): UiObject2? {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            dismissSystemErrorDialogs()
            ui.wait(Until.findObject(selector), 1_000)?.let { return it }
        }
        return null.also { diagnose("timeout waiting for $selector") }
    }

    fun appText(text: String): BySelector = By.pkg(APP).text(text)

    /** The system runtime-permission dialog's buttons, across Android 8–14 resource ids. */
    fun systemAllowButton(): BySelector = By.res(Pattern.compile(".*:id/permission_allow(_foreground_only)?_button"))
    fun systemDenyButton(): BySelector = By.res(Pattern.compile(".*:id/permission_deny(_and_dont_ask_again)?_button"))
    fun systemDontAskAgainCheckbox(): BySelector = By.res(Pattern.compile(".*:id/do_not_ask_checkbox"))
    fun anySystemPermissionDialog(): BySelector = By.res(Pattern.compile(".*:id/permission_(allow|deny).*"))

    /** Polls [condition] until true or the timeout passes. */
    fun eventually(timeoutMs: Long = 10_000, stepMs: Long = 250, condition: () -> Boolean): Boolean {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            if (condition()) return true
            dismissSystemErrorDialogs()
            Thread.sleep(stepMs)
        }
        return condition()
    }

    val listenerComponent = "$APP/$APP.access.ZarvisNotificationListener"
    val accessibilityComponent = "$APP/$APP.access.ZarvisAccessibilityService"
    val assistComponent = "$APP/$APP.assist.AssistActivity"
}
