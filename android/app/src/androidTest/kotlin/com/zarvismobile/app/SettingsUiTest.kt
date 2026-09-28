package com.zarvismobile.app

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import com.zarvismobile.app.Device.APP
import com.zarvismobile.app.Device.entry
import com.zarvismobile.app.Device.evidence
import com.zarvismobile.app.Device.eventually
import com.zarvismobile.app.Device.ui
import com.zarvismobile.domain.notification.NotificationMode
import com.zarvismobile.domain.notification.NotificationPrivacySettings
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The Android UI for Phase 1, driven like a user: Settings > Notifications (blueprint §8/§12)
 * changes real stored settings, and Settings > Permissions & Device Access shows every
 * capability with its live state.
 */
@RunWith(AndroidJUnit4::class)
class SettingsUiTest {

    private fun find(text: String, timeoutMs: Long = 10_000): UiObject2? {
        ui.wait(Until.findObject(By.pkg(APP).text(text)), 2_000)?.let { return it }
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            ui.findObject(By.pkg(APP).text(text))?.let { return it }
            val scrollable = ui.findObject(By.pkg(APP).scrollable(true)) ?: return null
            if (!scrollable.scroll(Direction.DOWN, 0.6f)) return ui.findObject(By.pkg(APP).text(text))
        }
        return null
    }

    private fun openSettings() {
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
            (find("Notifications") ?: error("Notifications page not listed")).click()
            for (section in listOf("Notification access", "Notification mode", "Spoken notifications", "Quiet hours", "Only with headphones", "While the phone is locked", "Include security & banking alerts", "Excluded apps")) {
                assertNotNull("section \"$section\" shown", find(section))
            }
            evidence("ui settings>notifications all section 12 controls rendered")

            ui.pressBack() // back to the hub, then reopen to start at the top
            (find("Notifications") ?: error("hub")).click()
            (find("Contact + app") ?: error("mode option")).click()
            assertTrue(eventually { runBlocking { entry.notificationSettings().current().mode } == NotificationMode.CONTACT_AND_APP })
            (find("Spoken notifications") ?: error("spoken toggle")).click()
            assertTrue(eventually { runBlocking { entry.notificationSettings().current().speakEnabled } })
            (find("Only with headphones") ?: error("headphones toggle")).click()
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
            (find("Permissions & Device Access") ?: error("Permissions page not listed")).click()
            val names = entry.capabilityRegistry().capabilities.map { it.name }
            for (name in names) assertNotNull("capability \"$name\" shown", find(name, timeoutMs = 20_000))
            evidence("ui permission_center rendered ${names.size} capabilities: $names")
        }
    }
}
