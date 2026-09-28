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
            val list = ui.findObject(By.pkg(APP).scrollable(true)) ?: return null
            list.scroll(direction, 0.6f)
            ui.waitForIdle()
            val after = visibleTexts()
            if (after == before) return text?.let { t -> ui.findObject(By.pkg(APP).text(t)) }
            before = after
        }
        return text?.let { t -> ui.findObject(By.pkg(APP).text(t)) }
    }

    /** Finds [text] on the current page: from the top, scrolling down through it. */
    private fun find(text: String): UiObject2? {
        ui.wait(Until.findObject(By.pkg(APP).text(text)), 2_000)?.let { return it }
        scrollUntilStuck(Direction.UP)
        return scrollUntilStuck(Direction.DOWN, text) ?: null.also { Device.diagnose("SettingsUiTest: \"$text\" not found") }
    }

    /** Finds and clicks [text]; a node that recomposed between finding and clicking is found again. */
    private fun tap(text: String, what: String) {
        repeat(3) {
            val node = find(text) ?: error(what)
            try {
                node.click()
                return
            } catch (e: StaleObjectException) {
                ui.waitForIdle()
            }
        }
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
