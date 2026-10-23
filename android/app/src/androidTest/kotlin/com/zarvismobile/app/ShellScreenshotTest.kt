package com.zarvismobile.app

import android.graphics.Bitmap
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelectable
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.zarvismobile.app.Device.entry
import com.zarvismobile.app.Device.evidence
import com.zarvismobile.data.local.prefs.AppPreferences
import com.zarvismobile.domain.presentation.UiString
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

/**
 * Design evidence, not a functional check: the real app, against the real backend, photographed in light + English and dark + Hindi:
 * the first welcome page, every tab of the tab bar (Chat with a short conversation in it), and the Settings, Memory, Usage and Plans
 * pages opened from Work. The pictures go to the app's own files folder, each with a small JPEG copy (`thumb-*.jpg`) that the CI job
 * prints into its log for reviewers who cannot download artifacts; scripts/emulator/verify.sh pulls them into
 * build/emulator-evidence/screenshots/, which the CI job uploads. The test fails only when a page cannot be reached or a picture
 * cannot be taken.
 */
@RunWith(AndroidJUnit4::class)
class ShellScreenshotTest {
    @get:Rule val guard = verificationGuard(minutes = 6)
    @get:Rule val compose = createEmptyComposeRule()

    // Chat last: it may raise the keyboard, and the tab bar hides while the keyboard is up.
    private val tabs = listOf(
        "home" to UiString.NAV_HOME,
        "capabilities" to UiString.NAV_CAPABILITIES,
        "tasks" to UiString.NAV_TASKS,
        "work" to UiString.NAV_WORK,
        "chat" to UiString.NAV_CHAT,
    )

    /** Pages opened from the Work tab, by their card's title. */
    private val workPages = listOf(
        "settings" to UiString.WORK_SETTINGS_TITLE,
        "memory" to UiString.WORK_MEMORY_TITLE,
        "usage" to UiString.WORK_USAGE_TITLE,
        "plans" to UiString.WORK_PLANS_TITLE,
    )

    private fun photograph(folder: File, name: String) {
        val picture = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        assertTrue("no screenshot of $name", picture != null)
        FileOutputStream(File(folder, "$name.png")).use { picture.compress(Bitmap.CompressFormat.PNG, 100, it) }
        val width = 360
        val thumb = Bitmap.createScaledBitmap(picture, width, picture.height * width / picture.width, true)
        FileOutputStream(File(folder, "thumb-$name.jpg")).use { thumb.compress(Bitmap.CompressFormat.JPEG, 70, it) }
    }

    /** Lets the page load what it shows (its own requests to the backend) before the picture. */
    private fun settle() {
        compose.waitForIdle()
        Thread.sleep(1_500)
        compose.waitForIdle()
    }

    @Test
    fun photographsEveryTabInLightEnglishAndDarkHindi() {
        val preferences = AppPreferences(Device.app) // the same DataStore file the app reads
        val folder = File(Device.app.getExternalFilesDir(null), "zarvis-screenshots").apply { deleteRecursively(); mkdirs() }
        var taken = 0
        try {
            for ((dark, language) in listOf(false to "en", true to "hi")) {
                runBlocking {
                    preferences.setOnboardingComplete(false)
                    preferences.setDarkTheme(dark)
                    preferences.setLocale(language)
                }
                val look = if (dark) "dark" else "light"
                ActivityScenario.launch(MainActivity::class.java).use {
                    // The first welcome page, then skip it like a user would.
                    val skip = hasText(UiString.ONBOARDING_SKIP.text(language))
                    val home = hasText(UiString.NAV_HOME.text(language)) and isSelectable()
                    compose.waitUntil(20_000) { listOf(skip, home).any { compose.onAllNodes(it).fetchSemanticsNodes().isNotEmpty() } }
                    if (compose.onAllNodes(skip).fetchSemanticsNodes().isNotEmpty()) {
                        settle()
                        photograph(folder, "$look-$language-welcome")
                        taken++
                        compose.onAllNodes(skip).onFirst().performClick()
                    }
                    // A short conversation, so Chat shows both kinds of message (a greeting the backend answers itself).
                    runBlocking {
                        entry.orchestrator().startNewConversation()
                        entry.orchestrator().handleTurn(if (language == "hi") "नमस्ते" else "hello", "screenshot-test")
                    }
                    // Work's pages first: Chat (last) may raise the keyboard, which hides the tab bar.
                    for ((name, title) in workPages) {
                        val work = hasText(UiString.NAV_WORK.text(language)) and isSelectable()
                        compose.waitUntil(20_000) { compose.onAllNodes(work).fetchSemanticsNodes().isNotEmpty() }
                        compose.onAllNodes(work).onFirst().performClick()
                        compose.waitForIdle()
                        val open = hasContentDescription(UiString.COMMON_OPEN_NAMED.format(language, title.text(language)))
                        compose.onAllNodes(hasScrollAction()).onFirst().performScrollToNode(open)
                        compose.onAllNodes(open).onFirst().performClick()
                        settle()
                        photograph(folder, "$look-$language-$name")
                        taken++
                        // Settings and Plans hide the tab bar: go back to Work the way a user would.
                        Device.ui.pressBack()
                        compose.waitForIdle()
                    }
                    for ((name, label) in tabs) {
                        val tab = hasText(label.text(language)) and isSelectable()
                        compose.waitUntil(20_000) { compose.onAllNodes(tab).fetchSemanticsNodes().isNotEmpty() }
                        compose.onAllNodes(tab).onFirst().performClick()
                        settle()
                        photograph(folder, "$look-$language-$name")
                        taken++
                    }
                }
            }
            evidence("ui shell screenshots taken=$taken (light+en, dark+hi; welcome, ${tabs.size} tabs, ${workPages.size} Work pages each)")
        } finally {
            runBlocking {
                preferences.setOnboardingComplete(true)
                preferences.setDarkTheme(false)
                preferences.setLocale("en")
            }
        }
    }
}
