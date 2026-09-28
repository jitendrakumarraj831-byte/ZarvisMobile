package com.zarvismobile.app

import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
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
    val ui: UiDevice get() = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    val app: ZarvisApplication get() = ApplicationProvider.getApplicationContext()
    val entry: VerificationEntryPoint get() = EntryPointAccessors.fromApplication(app, VerificationEntryPoint::class.java)

    /** Runs a command as the shell user (what `adb shell` can do), returning its output. */
    fun shell(command: String): String {
        val pfd: ParcelFileDescriptor = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        return FileInputStream(pfd.fileDescriptor).bufferedReader().use { it.readText() }.also { pfd.close() }
    }

    fun evidence(what: String) {
        val line = "ZARVIS_EVIDENCE sdk=$sdk $what"
        Log.i("ZarvisVerify", line)
        println(line)
    }

    fun waitFor(selector: BySelector, timeoutMs: Long = 10_000): UiObject2? = ui.wait(Until.findObject(selector), timeoutMs)

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
