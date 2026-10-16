package com.zarvismobile.app

import android.graphics.Bitmap
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelectable
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
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
 * Design evidence, not a functional check: the real app, against the real backend, photographed on every tab of the tab bar in
 * light + English and dark + Hindi. The pictures go to the app's own files folder; scripts/emulator/verify.sh pulls them into
 * build/emulator-evidence/screenshots/, which the CI job uploads. The test fails only when a tab cannot be reached or a picture
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

    @Test
    fun photographsEveryTabInLightEnglishAndDarkHindi() {
        val preferences = AppPreferences(Device.app) // the same DataStore file the app reads
        val folder = File(Device.app.getExternalFilesDir(null), "zarvis-screenshots").apply { deleteRecursively(); mkdirs() }
        var taken = 0
        try {
            runBlocking { preferences.setOnboardingComplete(true) }
            for ((dark, language) in listOf(false to "en", true to "hi")) {
                runBlocking {
                    preferences.setDarkTheme(dark)
                    preferences.setLocale(language)
                }
                val look = if (dark) "dark" else "light"
                ActivityScenario.launch(MainActivity::class.java).use {
                    // Onboarding can still appear on a fresh install; skip it like a user would.
                    val skip = hasText(UiString.ONBOARDING_SKIP.text(language))
                    val home = hasText(UiString.NAV_HOME.text(language)) and isSelectable()
                    compose.waitUntil(20_000) { listOf(skip, home).any { compose.onAllNodes(it).fetchSemanticsNodes().isNotEmpty() } }
                    if (compose.onAllNodes(skip).fetchSemanticsNodes().isNotEmpty()) compose.onAllNodes(skip).onFirst().performClick()
                    for ((name, label) in tabs) {
                        val tab = hasText(label.text(language)) and isSelectable()
                        compose.waitUntil(20_000) { compose.onAllNodes(tab).fetchSemanticsNodes().isNotEmpty() }
                        compose.onAllNodes(tab).onFirst().performClick()
                        compose.waitForIdle()
                        Thread.sleep(1_500) // the page's own requests to the backend
                        compose.waitForIdle()
                        val picture = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
                        assertTrue("no screenshot of $look/$language/$name", picture != null)
                        FileOutputStream(File(folder, "$look-$language-$name.png")).use { picture.compress(Bitmap.CompressFormat.PNG, 100, it) }
                        taken++
                    }
                }
            }
            evidence("ui shell screenshots taken=$taken (light+en, dark+hi; ${tabs.size} tabs each)")
        } finally {
            runBlocking {
                preferences.setDarkTheme(false)
                preferences.setLocale("en")
            }
        }
    }
}
