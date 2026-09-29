package com.zarvismobile.app

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.StaleObjectException
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import com.zarvismobile.app.Device.APP
import com.zarvismobile.app.Device.entry
import com.zarvismobile.app.Device.evidence
import com.zarvismobile.app.Device.eventually
import com.zarvismobile.app.Device.ui
import com.zarvismobile.domain.notification.NotificationMode
import com.zarvismobile.domain.notification.NotificationPrivacySettings
import java.util.regex.Pattern
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The Android UI for Phase 1, driven like a user: Settings > Notifications (blueprint §8/§12)
 * changes real stored settings, and Settings > Permissions & Device Access shows every
 * capability with its live state.
 */
@RunWith(AndroidJUnit4::class)
class SettingsUiTest {
    @get:Rule val guard = verificationGuard()

    /** The app's visible texts — used to tell whether a scroll actually moved (Compose's scroll() result isn't reliable). */
    private fun visibleTexts(): List<String> {
        ui.waitForIdle()
        // Compose recomposes while a list settles, so a node found a moment ago can be gone:
        // skip nodes that went stale instead of failing the snapshot.
        return ui.findObjects(By.pkg(APP).text(Pattern.compile(".+", Pattern.DOTALL)))
            .mapNotNull { node -> try { node.text } catch (e: StaleObjectException) { null } }
    }

    private fun scrollUntilStuck(direction: Direction, text: String? = null, maxSteps: Int = 25): UiObject2? {
        var before = visibleTexts()
        repeat(maxSteps) {
            text?.let { t -> ui.findObject(By.pkg(APP).text(t))?.let { return it } }
            // A page-sized scroll can jump over a row sitting just outside the viewport, so if the
            // row exists off screen, have Android bring it into view.
            if (text != null && Device.showOnScreen(text)) {
                scrollLog += "show=$text"
                awaitSettled()
                ui.findObject(By.pkg(APP).text(text))?.let { return it }
            }
            if (!ui.hasObject(By.pkg(APP).scrollable(true))) return null
            if (!swipePage(direction)) return text?.let { t -> ui.findObject(By.pkg(APP).text(t)) }
            val after = visibleTexts()
            if (after == before) return text?.let { t -> ui.findObject(By.pkg(APP).text(t)) }
            before = after
        }
        return text?.let { t -> ui.findObject(By.pkg(APP).text(t)) }
    }

    /**
     * Scrolls the page with the accessibility scroll action (as TalkBack does) rather than a
     * swipe: touch gestures proved unreliable here (an edge swipe is Android 14's Home gesture,
     * a fast one leaves the list flinging so the next tap only stops it, and a slow drag did not
     * scroll at all on the API 34 image). Returns false when the page cannot scroll further.
     */
    /** What each scroll attempt returned, for the failure diagnostics. */
    private val scrollLog = mutableListOf<String>()

    private fun swipePage(direction: Direction): Boolean {
        val moved = Device.accessibilityScroll(forward = direction == Direction.DOWN)
        scrollLog += "${if (direction == Direction.DOWN) "down" else "up"}=$moved"
        awaitSettled()
        return moved
    }

    /** Waits until two consecutive snapshots of the page are identical (the list stopped moving). */
    private fun awaitSettled() {
        var previous = visibleTexts()
        repeat(15) {
            Thread.sleep(200)
            val now = visibleTexts()
            if (now == previous) return
            previous = now
        }
    }

    /** Finds [text] on the current page: from the top, scrolling down through it. */
    private fun find(text: String): UiObject2? {
        ui.wait(Until.findObject(By.pkg(APP).text(text)), 2_000)?.let { return it }
        // The page may still be composing: wait until it has content or its list before scrolling.
        eventually(10_000) { ui.hasObject(By.pkg(APP).scrollable(true)) || ui.hasObject(By.pkg(APP).text(text)) }
        ui.findObject(By.pkg(APP).text(text))?.let { return it }
        scrollUntilStuck(Direction.UP)
        // Accessibility scrolling moves a page at a time; a title straddling a page boundary can
        // be skipped going down, so search back up too (the boundaries then fall elsewhere).
        return scrollUntilStuck(Direction.DOWN, text)
            ?: scrollUntilStuck(Direction.UP, text)
            ?: null.also { Device.diagnose("SettingsUiTest: \"$text\" not found; scrolls ${scrollLog.takeLast(12)}") }
    }

    /** Finds and clicks [text]; a node that recomposed between finding and clicking is found again. */
    private fun tap(text: String, what: String) {
        repeat(3) {
            find(text) ?: error(what)
            awaitSettled()
            // The list may still have been moving when the node was found; look again.
            val node = ui.findObject(By.pkg(APP).text(text)) ?: return@repeat
            try {
                node.click()
                return
            } catch (e: StaleObjectException) {
                ui.waitForIdle()
            }
        }
        Device.diagnose("SettingsUiTest: \"$text\" kept moving under the tap")
        error("$what: \"$text\" kept changing under the tap")
    }

    private fun openSettings() {
        // Nothing left over from an earlier test (e.g. the assistant overlay) may sit on top.
        if (ui.currentPackageName == APP && ui.hasObject(By.pkg(APP).text("Close"))) ui.pressBack()
        ui.wait(Until.hasObject(By.pkg(APP)), 15_000)
        // Onboarding appears on a fresh install; skip it like a user would.
        ui.wait(Until.findObject(By.pkg(APP).text("Skip")), 5_000)?.click()
        (ui.wait(Until.findObject(By.pkg(APP).desc("Settings")), 15_000) ?: error("Settings button not on Home")).click()
    }

    @Test
    fun notificationSettingsPageControlsRealSettings() {
        runBlocking { entry.notificationSettings().update { NotificationPrivacySettings() } }
        ActivityScenario.launch(MainActivity::class.java).use {
            openSettings()
            tap("Notifications", "Notifications page not listed")
            for (section in listOf("Notification access", "Notification mode", "Spoken notifications", "Quiet hours", "Only with headphones", "While the phone is locked", "Include security & banking alerts", "Excluded apps")) {
                assertNotNull("section \"$section\" shown", find(section))
            }
            evidence("ui settings>notifications all section 12 controls rendered")

            // System Back returns to the settings list (not out of Settings), then reopen at the top.
            ui.pressBack()
            assertNotNull("system Back returns to the settings hub", find("Permissions & Device Access"))
            evidence("ui settings>notifications system Back -> settings hub")
            tap("Notifications", "hub")
            tap("Contact + app", "mode option")
            assertTrue(eventually { runBlocking { entry.notificationSettings().current().mode } == NotificationMode.CONTACT_AND_APP })
            tap("Spoken notifications", "spoken toggle")
            assertTrue(eventually { runBlocking { entry.notificationSettings().current().speakEnabled } })
            tap("Only with headphones", "headphones toggle")
            assertTrue(eventually { !runBlocking { entry.notificationSettings().current().headphonesOnly } })
            evidence("ui settings>notifications taps persisted: mode=CONTACT_AND_APP speak=true headphonesOnly=false")
        }
        runBlocking { entry.notificationSettings().update { NotificationPrivacySettings() } }
        assertEquals(false, runBlocking { entry.notificationSettings().current().speakEnabled })
    }

    @Test
    fun permissionCenterListsEveryCapabilityWithLiveState() {
        ActivityScenario.launch(MainActivity::class.java).use {
            openSettings()
            tap("Permissions & Device Access", "Permissions page not listed")
            val names = entry.capabilityRegistry().capabilities.map { it.name }
            for (name in names) assertNotNull("capability \"$name\" shown", find(name))
            evidence("ui permission_center rendered ${names.size} capabilities: $names")
        }
    }
}
