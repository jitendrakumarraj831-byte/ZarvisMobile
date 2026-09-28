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
        val texts = runCatching { ui.findObjects(By.text(Pattern.compile(".+", Pattern.DOTALL))).mapNotNull { o -> o.text?.takeIf { it.isNotBlank() }?.let { "${o.applicationPackage}:$it" } } }
            .getOrDefault(emptyList())
        val res = runCatching { ui.findObjects(By.res(Pattern.compile(".*:id/.*"))).map { it.resourceName } }.getOrDefault(emptyList())
        val line = "ZARVIS_DIAG sdk=$sdk $label front=${ui.currentPackageName} texts=${texts.take(40)} ids=${res.distinct().take(40)}"
        Log.w("ZarvisVerify", line)
        println(line)
    }

    /** Waits for [selector]; on timeout records what was on screen instead (for the CI log). */
    fun waitFor(selector: BySelector, timeoutMs: Long = 15_000): UiObject2? =
        ui.wait(Until.findObject(selector), timeoutMs) ?: null.also { diagnose("timeout waiting for $selector") }

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
            Thread.sleep(stepMs)
        }
        return condition()
    }

    val listenerComponent = "$APP/$APP.access.ZarvisNotificationListener"
    val accessibilityComponent = "$APP/$APP.access.ZarvisAccessibilityService"
    val assistComponent = "$APP/$APP.assist.AssistActivity"
}
