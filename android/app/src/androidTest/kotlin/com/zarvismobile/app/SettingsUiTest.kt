package com.zarvismobile.app

import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.zarvismobile.app.Device.entry
import com.zarvismobile.app.Device.evidence
import com.zarvismobile.app.Device.eventually
import com.zarvismobile.app.Device.ui
import com.zarvismobile.domain.notification.NotificationMode
import com.zarvismobile.domain.notification.NotificationPrivacySettings
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The Android UI for Phase 1, driven like a user: Settings > Notifications (blueprint §8/§12)
 * changes real stored settings, and Settings > Permissions & Device Access shows every
 * capability with its live state.
 *
 * Rows are reached with Compose's own scroll-to-node and tapped with injected touches; system
 * Back is a real key press. Blind page-by-page accessibility
 * scrolling proved non-deterministic on the 320x640 API 34 image (rows further down a lazy
 * list were never composed, or went stale between finding and tapping).
 */
@RunWith(AndroidJUnit4::class)
class SettingsUiTest {
    @get:Rule val guard = verificationGuard()
    @get:Rule val compose = createEmptyComposeRule()

    /** Scrolls the current Settings page until [text] is on screen and returns that node. */
    private fun reveal(text: String): SemanticsNodeInteraction {
        val match = hasText(text)
        // The page may still be composing after navigation.
        compose.waitUntil(15_000) {
            compose.onAllNodes(match).fetchSemanticsNodes().isNotEmpty() ||
                compose.onAllNodes(hasScrollToIndexAction()).fetchSemanticsNodes().isNotEmpty() ||
                compose.onAllNodes(hasScrollAction()).fetchSemanticsNodes().isNotEmpty()
        }
        // A lazy list only composes what is near the screen: scroll it until the row exists.
        if (compose.onAllNodes(match).fetchSemanticsNodes().isEmpty() &&
            compose.onAllNodes(hasScrollToIndexAction()).fetchSemanticsNodes().isNotEmpty()
        ) {
            compose.onAllNodes(hasScrollToIndexAction()).onFirst().performScrollToNode(match)
        }
        val node = compose.onAllNodes(match).onFirst()
        runCatching { node.performScrollTo() } // a plain scrolling column: bring it fully on screen
        return node.assertIsDisplayed()
    }

    private fun tap(text: String) {
        reveal(text).performClick()
        compose.waitForIdle()
    }

    private fun openSettings() {
        // While a Compose test rule is active, the app's frame clock only advances inside Compose
        // test calls, so Home is driven through them too (UI Automator waits would see no frames).
        val skip = hasText("Skip")
        val settings = hasContentDescription("Settings")
        val close = hasText("Close")
        compose.waitUntil(20_000) {
            listOf(skip, settings, close).any { compose.onAllNodes(it).fetchSemanticsNodes().isNotEmpty() }
        }
        // Nothing left over from an earlier test (e.g. the assistant overlay) may sit on top.
        if (compose.onAllNodes(close).fetchSemanticsNodes().isNotEmpty()) { ui.pressBack(); compose.waitForIdle() }
        // Onboarding appears on a fresh install; skip it like a user would.
        if (compose.onAllNodes(skip).fetchSemanticsNodes().isNotEmpty()) compose.onAllNodes(skip).onFirst().performClick()
        compose.waitUntil(20_000) { compose.onAllNodes(settings).fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodes(settings).onFirst().performClick()
        compose.waitUntil(15_000) { compose.onAllNodes(hasText("Settings")).fetchSemanticsNodes().isNotEmpty() }
    }

    @Test
    fun notificationSettingsPageControlsRealSettings() {
        runBlocking { entry.notificationSettings().update { NotificationPrivacySettings() } }
        ActivityScenario.launch(MainActivity::class.java).use {
            openSettings()
            tap("Notifications")
            for (section in listOf("Notification access", "Notification mode", "Spoken notifications", "Quiet hours", "Only with headphones", "While the phone is locked", "Include security & banking alerts", "Excluded apps")) {
                reveal(section)
            }
            evidence("ui settings>notifications all section 12 controls rendered")

            // System Back returns to the settings list (not out of Settings), then reopen at the top.
            ui.pressBack()
            reveal("Permissions & Device Access")
            evidence("ui settings>notifications system Back -> settings hub")
            tap("Notifications")
            tap("Contact + app")
            assertTrue(eventually { runBlocking { entry.notificationSettings().current().mode } == NotificationMode.CONTACT_AND_APP })
            tap("Spoken notifications")
            assertTrue(eventually { runBlocking { entry.notificationSettings().current().speakEnabled } })
            tap("Only with headphones")
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
            tap("Permissions & Device Access")
            val names = entry.capabilityRegistry().capabilities.map { it.name }
            for (name in names) reveal(name)
            evidence("ui permission_center rendered ${names.size} capabilities: $names")
        }
    }
}
