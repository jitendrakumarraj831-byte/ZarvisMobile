package com.zarvismobile.app

import android.app.NotificationManager
import android.content.Context
import android.provider.AlarmClock
import android.provider.MediaStore
import android.provider.Settings
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import com.zarvismobile.agents.TurnOutcome
import com.zarvismobile.app.Device.APP
import com.zarvismobile.app.Device.entry
import com.zarvismobile.app.Device.evidence
import com.zarvismobile.app.Device.eventually
import com.zarvismobile.app.Device.sdk
import com.zarvismobile.app.Device.shell
import com.zarvismobile.app.Device.ui
import com.zarvismobile.domain.access.RationaleChoice
import com.zarvismobile.domain.entity.ToolResultStatus
import java.util.regex.Pattern
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters

/**
 * Phase D (continued): spoken and typed commands that open things on the phone, run for real — "settings kholo", "gallery kholo",
 * "camera kholo", Devanagari, and a request only the Brain understands ("show me my gallery"), which the backend hands back to the
 * phone as a device action. Every success is checked against the app Android really put in front; an app this image does not have
 * must be an honest failure, never "Opening …".
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class AppAutomationTest {
    @get:Rule val guard = verificationGuard()

    private fun turn(utterance: String): TurnOutcome = runBlocking {
        val responders = CoroutineScope(Dispatchers.Default)
        responders.launch { entry.confirmationPort().pending.filterNotNull().collect { it.respond(true) } }
        responders.launch { entry.rationalePort().pending.filterNotNull().collect { it.respond(RationaleChoice.NOT_NOW) } }
        try {
            withTimeout(60_000) { entry.orchestrator().handleTurn(utterance, accountId = "emulator-verification") }
        } finally {
            responders.cancel()
        }
    }

    /** Apps that answer an intent, asked as the shell (the app's own query is filtered by package visibility). */
    private fun handlers(action: String, category: String = "android.intent.category.DEFAULT", data: String? = null): List<String> {
        val out = shell(
            "cmd package query-activities -a $action -c $category" +
                (if (category != "android.intent.category.DEFAULT") " -c android.intent.category.DEFAULT" else "") +
                (data?.let { " -d $it" } ?: ""),
        )
        return Regex("""packageName=([A-Za-z0-9_.]+)""").findAll(out).map { it.groupValues[1] }.distinct().toList()
    }

    private val homes: List<String> by lazy { handlers("android.intent.action.MAIN", "android.intent.category.HOME") }

    /** Android's permission screens, which a just-opened app (the camera) may show over itself on its first start. */
    private val permissionScreens = setOf("com.android.packageinstaller", "com.android.permissioncontroller", "com.google.android.permissioncontroller")

    /** The app now in front, once it is one of [expected] (or Android's own chooser when several qualify); null if none came up. */
    private fun frontApp(expected: (String) -> Boolean): String? {
        var front: String? = null
        eventually(15_000) {
            front = ui.currentPackageName
            front?.let(expected) == true
        }
        return front?.takeIf(expected)
    }

    private fun leave(front: String?) {
        front?.takeIf { it != APP && it != "android" && it !in homes && it !in permissionScreens && it != "com.android.systemui" }
            ?.let { shell("am force-stop $it") }
        ui.pressHome()
    }

    /**
     * "Open a kind of app": a success must have put a matching app in front ([roleApps], or any real app when this image has none for
     * the role and one was found by its name); a failure must be the honest "couldn't find", and only when no app answers the role.
     */
    private fun opensKindOfApp(
        utterance: String,
        label: String,
        roleApps: List<String>,
        expectedStatus: ToolResultStatus = ToolResultStatus.COMPLETED,
        honestFailure: String = "couldn't find",
    ): TurnOutcome {
        ui.pressHome()
        val outcome = turn(utterance)
        when (outcome.result?.status) {
            expectedStatus -> {
                val front = frontApp { pkg ->
                    if (roleApps.isEmpty()) pkg != APP && pkg !in homes else pkg in roleApps || pkg in permissionScreens || (roleApps.size > 1 && pkg == "android")
                }
                assertTrue("\"$utterance\" said \"${outcome.message}\" but front=${ui.currentPackageName} (expected one of $roleApps)", front != null)
                evidence("$label: \"$utterance\" -> ${outcome.result?.status} \"${outcome.message}\", in front: $front (role apps: $roleApps)")
                leave(front)
            }
            ToolResultStatus.FAILED -> {
                assertTrue("\"$utterance\" failed although $roleApps answer the role: ${outcome.message}", roleApps.isEmpty())
                assertTrue(outcome.message, outcome.message.contains(honestFailure))
                evidence("$label: \"$utterance\" -> FAILED honestly, no such app on this image: ${outcome.message}")
                ui.pressHome()
            }
            else -> throw AssertionError("\"$utterance\" -> ${outcome.result?.status}: ${outcome.message}")
        }
        return outcome
    }

    /** The app makes (or keeps) its guest session on start; its first screen (onboarding or the tabs) shows once it has one. */
    private fun startAppAndNewChat() {
        ActivityScenario.launch(MainActivity::class.java).use {
            Device.waitFor(By.pkg(APP).text(Pattern.compile("Skip|Chat")), 30_000) ?: error("the app did not start")
        }
        runBlocking { entry.orchestrator().startNewConversation() }
    }

    private fun history(): List<Pair<String, String>> =
        runBlocking { entry.orchestrator().restoreConversation() }.messages.map { it.role to it.content }

    @Test
    fun a_settingsKholoOpensTheSettingsApp() {
        val settingsApps = handlers(Settings.ACTION_SETTINGS)
        assertTrue("this image has a Settings app", settingsApps.isNotEmpty())
        for (utterance in listOf("settings kholo", "open settings", "सेटिंग्स खोलो")) {
            opensKindOfApp(utterance, "settings", settingsApps, ToolResultStatus.USER_ACTION_REQUIRED)
        }
    }

    @Test
    fun b_galleryKholoOpensThePhonesGallery() {
        opensKindOfApp("gallery kholo", "gallery", handlers("android.intent.action.MAIN", "android.intent.category.APP_GALLERY"))
    }

    @Test
    fun c_cameraKholoOpensTheCameraApp() {
        val cameras = handlers(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)
        val systemUiBefore = shell("pidof com.android.systemui").trim()
        try {
            opensKindOfApp("camera kholo", "camera", cameras)
        } catch (e: AssertionError) {
            // The API 26 image's System UI crashes when another app's window takes the screen (the bug its permission and camera tests
            // already record). Not a ZARVIS result: recorded as platform-blocked, never as a pass.
            val systemUiAfter = shell("pidof com.android.systemui").trim()
            if (systemUiAfter == systemUiBefore) throw e
            evidence("camera UNVERIFIED platform-blocked: System UI crashed (pid $systemUiBefore -> $systemUiAfter): ${e.message}")
            Assume.assumeTrue("camera: Android System UI crashed during the step (platform-blocked)", false)
        } finally {
            cameras.forEach { shell("am force-stop $it") }
        }
    }

    @Test
    fun d_devanagariOpensTheClockAndAnAppThatIsNotInstalledIsAnHonestFailure() {
        opensKindOfApp("घड़ी खोलो", "clock (Devanagari)", handlers(AlarmClock.ACTION_SHOW_ALARMS))

        ui.pressHome()
        val before = ui.currentPackageName
        val missing = turn("व्हाट्सएप खोलो")
        if (!shell("pm list packages com.whatsapp").contains("package:com.whatsapp")) {
            assertEquals(missing.message, ToolResultStatus.FAILED, missing.result?.status)
            assertTrue(missing.message, missing.message.contains("couldn't find"))
            assertFalse("nothing was opened", eventually(3_000) { ui.currentPackageName.let { it != before && it != APP && it !in homes } })
            evidence("WhatsApp not installed: \"व्हाट्सएप खोलो\" -> FAILED honestly: ${missing.message}")
        }
    }

    /**
     * The request the phone's own words do not cover goes to the Brain (the backend, here with its development planner), which hands
     * phone.open_app back instead of describing manual steps. The phone runs it, and its real result is recorded in the conversation.
     */
    @Test
    fun e_theBrainHandsAGalleryRequestToThePhoneAndTheRealResultIsRecorded() {
        startAppAndNewChat()

        val galleries = handlers("android.intent.action.MAIN", "android.intent.category.APP_GALLERY")
        opensKindOfApp("show me my gallery", "gallery via the Brain", galleries)

        val restored = runBlocking { entry.orchestrator().restoreConversation() }
        val history = restored.messages.map { it.role to it.content }
        assertEquals("the request and the phone's own result are the conversation", 2, history.size)
        assertEquals("user" to "show me my gallery", history[0])
        assertEquals("assistant", history[1].first)
        assertTrue("the reply is the phone's result: ${history[1].second}", history[1].second.startsWith("Opening ") || history[1].second.contains("couldn't find"))
        evidence("Brain handoff: conversation ${restored.conversation.id} recorded ${history[1]}")
    }

    /** Said with the app named, on the phone itself: the app (or a browser at its web address) opens at the results. */
    @Test
    fun f_aSearchInANamedAppOpensItsResults() {
        opensKindOfApp("youtube pe arijit songs search karo", "search", emptyList(), honestFailure = "Nothing on this phone")
        opensKindOfApp("airport ka rasta dikhao", "directions", emptyList(), ToolResultStatus.USER_ACTION_REQUIRED, honestFailure = "Nothing on this phone")
    }

    /**
     * A message is only ever a draft: the Brain hands message.draft to the phone, the SMS app opens with the text and the number
     * filled in, and it waits there for the user to press Send. Nothing is sent by ZARVIS (this test never presses Send either).
     */
    @Test
    fun g_aMessageIsADraftTheUserSends() {
        startAppAndNewChat()
        val smsApps = handlers("android.intent.action.SENDTO", data = "smsto:5551234")
        val outcome = opensKindOfApp("send hi to 5551234", "message draft", smsApps, ToolResultStatus.USER_ACTION_REQUIRED, honestFailure = "no SMS app")
        if (outcome.result?.status == ToolResultStatus.USER_ACTION_REQUIRED) {
            assertTrue(outcome.message, outcome.message.contains("Press Send"))
            assertEquals(listOf("user" to "send hi to 5551234", "assistant" to outcome.message), history())
        }
    }

    /**
     * A request with two phone steps, through the Brain: the first step runs, the Brain plans the second from what is left, and the
     * second runs. The conversation holds the request and each step's real result, nothing else.
     */
    @Test
    fun h_aMultiStepRequestRunsOneStepAfterTheOther() {
        startAppAndNewChat()
        ui.pressHome()
        val utterance = "show me the clock app and then show me the settings"
        val outcome = turn(utterance)
        val steps = outcome.message.lines()
        assertEquals(outcome.message, 2, steps.size)
        assertEquals(outcome.message, ToolResultStatus.USER_ACTION_REQUIRED, outcome.result?.status)
        val settingsApps = handlers(Settings.ACTION_SETTINGS)
        val front = frontApp { it in settingsApps }
        assertTrue("the second step opened Settings; front=${ui.currentPackageName}", front != null)
        assertEquals(listOf("user" to utterance, "assistant" to steps[0], "assistant" to steps[1]), history())
        evidence("multi-step: \"$utterance\" -> ${steps.joinToString(" | ")}; in front: $front")
        handlers(AlarmClock.ACTION_SHOW_ALARMS).forEach { shell("am force-stop $it") }
        leave(front)
    }

    /**
     * A reminder only the Brain takes (the time comes first: "1 minute baad … reminder set karo"). The backend hands personal.reminder back
     * with a title of its own that has no time in it, as a real model writes one; the phone schedules it at the time the user said, Android
     * really delivers its notification, and the conversation holds the phone's real result. Before the fix it came back FAILED ("When
     * should I remind you?") and was recorded on the server as FAILED.
     */
    @Test
    fun i_aReminderTheBrainHandsToThePhoneIsCreatedAndItsNotificationIsDelivered() {
        if (sdk >= 33) shell("pm grant $APP android.permission.POST_NOTIFICATIONS")
        // Exact timing on Android 12+ needs "Alarms & reminders" (granted by default only on 12).
        if (sdk >= 31) shell("appops set $APP SCHEDULE_EXACT_ALARM allow")
        startAppAndNewChat()

        val utterance = "1 minute baad paani peene ka reminder set karo"
        val outcome = turn(utterance)

        assertEquals(outcome.message, ToolResultStatus.COMPLETED, outcome.result?.status)
        assertEquals("personal.reminder", outcome.result?.skillId)
        assertTrue(outcome.message, outcome.message.startsWith("Reminder set for "))
        assertEquals("the request and the phone's own result are the conversation", listOf("user" to utterance, "assistant" to outcome.message), history())
        val manager = Device.app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val delivered = eventually(150_000, stepMs = 2_000) {
            manager.activeNotifications.any { n ->
                listOfNotNull(n.notification.extras.getCharSequence("android.title"), n.notification.extras.getCharSequence("android.text"))
                    .any { it.toString().contains("paani peene", ignoreCase = true) }
            }
        }
        assertTrue("the reminder's notification was posted by Android on API $sdk", delivered)
        evidence("Brain reminder handoff: \"$utterance\" -> ${outcome.message}; notification delivered on sdk=$sdk")
    }
}
