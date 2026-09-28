package com.zarvismobile.app

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import com.zarvismobile.agents.TurnOutcome
import com.zarvismobile.app.Device.APP
import com.zarvismobile.app.Device.entry
import com.zarvismobile.app.Device.evidence
import com.zarvismobile.app.Device.eventually
import com.zarvismobile.app.Device.sdk
import com.zarvismobile.app.Device.shell
import com.zarvismobile.app.Device.ui
import com.zarvismobile.app.access.SpeakOutcome
import com.zarvismobile.app.access.ZarvisAccessibilityService
import com.zarvismobile.app.access.ZarvisNotificationListener
import com.zarvismobile.domain.access.AccessResult
import com.zarvismobile.domain.access.AccessState
import com.zarvismobile.domain.access.RationaleChoice
import com.zarvismobile.domain.capability.CapabilityId
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.entity.SkillExecutionContext
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.entity.ToolCall
import com.zarvismobile.domain.entity.ToolExecutionOutcome
import com.zarvismobile.domain.entity.ToolResultStatus
import com.zarvismobile.domain.notification.LockScreenBehavior
import com.zarvismobile.domain.notification.NotificationMode
import com.zarvismobile.domain.notification.QuietHours
import com.zarvismobile.domain.skill.ActiveNotifications
import com.zarvismobile.domain.skill.GlobalAction
import com.zarvismobile.domain.skill.ScreenRead
import com.zarvismobile.domain.skill.TapPlan
import com.zarvismobile.domain.skill.UsageReport
import java.time.LocalTime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters

/**
 * Phase D: the six special-access capabilities against the real Android services. Access is
 * granted and revoked the way `adb` does it (the user's Settings toggles write the same
 * state), and every assertion reads back what Android itself reports.
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class SpecialAccessTest {
    @get:Rule val diagnose = DiagnoseOnFailure()

    private fun state(permission: PermissionType) = runBlocking { entry.deviceAccessPort().state(permission) }

    /**
     * Runs one conversation turn through the real orchestrator + ToolPipeline, answering the
     * confirmation with [confirm] (as the user would in the dialog) and any explanation with Not now.
     */
    private fun turn(utterance: String, confirm: Boolean = true): TurnOutcome = runBlocking {
        val responders = CoroutineScope(Dispatchers.Default)
        responders.launch { entry.confirmationPort().pending.filterNotNull().collect { it.respond(confirm) } }
        responders.launch { entry.rationalePort().pending.filterNotNull().collect { it.respond(RationaleChoice.NOT_NOW) } }
        try {
            withTimeout(60_000) { entry.orchestrator().handleTurn(utterance, accountId = "emulator-verification") }
        } finally {
            responders.cancel()
        }
    }

    private fun postShellNotification(tag: String, title: String, text: String) {
        // Single tokens: executeShellCommand splits on whitespace without shell quoting.
        val out = shell("cmd notification post -t $title $tag $text").trim()
        if (out.isNotEmpty()) evidence("shell notification post $tag -> $out")
    }

    private fun openClock(): String {
        shell("am start -W -a android.intent.action.SHOW_ALARMS")
        assertTrue("clock app in front", eventually(10_000) { ui.currentPackageName?.contains("clock") == true })
        return ui.currentPackageName
    }

    // --- notification_read ---------------------------------------------------------------

    /** What the user's switch on Android's "Notification access" page does (cmd exists since Android 8.0). */
    private fun setListener(enabled: Boolean) {
        val out = shell("cmd notification ${if (enabled) "allow_listener" else "disallow_listener"} ${Device.listenerComponent}")
        if (out.contains("Unknown", ignoreCase = true) || out.contains("usage", ignoreCase = true)) {
            if (enabled) shell("settings put secure enabled_notification_listeners ${Device.listenerComponent}")
            else shell("settings delete secure enabled_notification_listeners")
        }
    }

    @Test
    fun a_notificationAccessOpensItsSettingsPageAndIsVerified() {
        setListener(false)
        assertTrue(eventually { state(PermissionType.NOTIFICATION_LISTENER) == AccessState.SPECIAL_ACCESS_OFF })

        // Allow → the exact Android Settings page → back without enabling → still off (verified, not trusted).
        ActivityScenario.launch(MainActivity::class.java).use {
            val result = CoroutineScope(Dispatchers.Default).async {
                entry.accessCoordinator().ensure(entry.capabilityRegistry().get(CapabilityId.NOTIFICATION_READ))
            }
            (Device.waitFor(Device.appText("Open settings")) ?: error("explanation not shown")).click()
            assertTrue("Android Settings opened", ui.wait(Until.hasObject(By.pkg("com.android.settings")), 10_000) == true)
            evidence("notification_read settings_page=${ui.currentPackageName}")
            ui.pressBack()
            val denied = runBlocking { withTimeout(30_000) { result.await() } }
            assertTrue(denied is AccessResult.Denied && denied.permanently)
        }

        setListener(true)
        assertTrue(eventually(15_000) { state(PermissionType.NOTIFICATION_LISTENER) == AccessState.GRANTED })
        assertTrue("listener bound by Android", eventually(15_000) { ZarvisNotificationListener.connected != null })
        evidence("notification_read granted -> listener connected")

        runBlocking { entry.notificationSettings().update { it.copy(mode = NotificationMode.CONTACT_APP_PREVIEW, includeSensitive = false) } }
        if (sdk >= 28) {
            postShellNotification("zarvis_msg", "Asha", "Dinner_tonight?")
            postShellNotification("zarvis_otp", "Bank", "OTP:482913")
            // Posting is asynchronous: wait until Android shows both to the listener.
            var seen = emptyList<String>()
            val visible = eventually(15_000, stepMs = 500) {
                val active = runBlocking { entry.notificationReader().active() }
                seen = (active as? ActiveNotifications.Available)?.items?.map { "${it.packageName}:${it.key}" } ?: listOf("$active")
                seen.count { it.startsWith("com.android.shell:") && (it.contains("zarvis_msg") || it.contains("zarvis_otp")) } >= 2
            }
            assertTrue("shell notifications visible to the listener: $seen", visible)

            val outcome = turn("read my notifications")
            assertEquals(ToolResultStatus.COMPLETED, outcome.result?.status)
            assertTrue(outcome.message, outcome.message.contains("Dinner_tonight?"))
            assertFalse("OTP never shown by default", outcome.message.contains("482913"))
            assertTrue(outcome.message.contains("Security or banking alert"))
            evidence("notification_read pipeline COMPLETED evidence=${outcome.result?.verificationEvidence}")

            val declined = turn("read my notifications", confirm = false)
            assertEquals(ToolResultStatus.DENIED, declined.result?.status)
            evidence("notification_read confirmation declined -> DENIED")
        } else {
            val outcome = turn("read my notifications")
            assertEquals(ToolResultStatus.COMPLETED, outcome.result?.status)
            evidence("notification_read pipeline COMPLETED (no shell poster on API $sdk) evidence=${outcome.result?.verificationEvidence}")
        }
    }

    // --- notification_speak --------------------------------------------------------------

    @Test
    fun b_spokenNotificationsFollowTheRulesAndUseRealTts() {
        val speaker = entry.notificationSpeaker()
        val now = LocalTime.now().let { it.hour * 60 + it.minute }
        runBlocking {
            entry.notificationSettings().update {
                it.copy(
                    mode = NotificationMode.APP_AND_TYPE,
                    speakEnabled = true,
                    headphonesOnly = false,
                    lockScreen = LockScreenBehavior.SAME_AS_UNLOCKED,
                    quietHours = QuietHours(false, 0, 0),
                )
            }
        }
        val sample = runBlocking { speaker.speakSample() }
        // Some emulator images ship without any text-to-speech engine. ZARVIS must then say so
        // (Failed), never claim it spoke; on images with an engine it must really start speaking.
        val noEngine = sample == SpeakOutcome.Failed("no text-to-speech engine available")
        val engines = Regex("""packageName=([A-Za-z0-9_.]+)""")
            .findAll(shell("cmd package query-services -a android.intent.action.TTS_SERVICE")).map { it.groupValues[1] }.toSet()
        evidence("notification_speak sample=$sample installed_tts_engines=$engines")
        assertTrue("real TTS engine started speaking: $sample", sample is SpeakOutcome.Spoken || noEngine)
        // "No engine" is only acceptable when Android itself reports none installed.
        if (noEngine) assertTrue("reported no engine but Android lists $engines", engines.isEmpty())

        if (sdk >= 28) {
            /** The decision for exactly this notification (matched by its tag in Android's key). */
            fun postAndAwait(tag: String, title: String, text: String): SpeakOutcome? {
                postShellNotification(tag, title, text)
                var outcome: SpeakOutcome? = null
                eventually(15_000) {
                    outcome = speaker.recentOutcomes.value.lastOrNull { (key, _) -> key.contains("|$tag|") }?.second
                    outcome != null
                }
                return outcome
            }
            val spoken = postAndAwait("zarvis_speak1", "Ravi", "Running_late")
            if (noEngine) {
                assertEquals(SpeakOutcome.Failed("no text-to-speech engine available"), spoken)
            } else {
                assertTrue("new notification spoken: $spoken (recent=${speaker.recentOutcomes.value})", spoken is SpeakOutcome.Spoken)
            }
            assertEquals(SpeakOutcome.Skipped("security or banking alert"), postAndAwait("zarvis_speak2", "Bank", "OTP:112233"))

            runBlocking { entry.notificationSettings().update { it.copy(quietHours = QuietHours(true, now, (now + 60) % (24 * 60))) } }
            assertEquals(SpeakOutcome.Skipped("quiet hours"), postAndAwait("zarvis_speak3", "Ravi", "Quiet_test"))

            runBlocking { entry.notificationSettings().update { it.copy(quietHours = QuietHours(false, 0, 0), headphonesOnly = true) } }
            assertEquals(SpeakOutcome.Skipped("no headphones connected"), postAndAwait("zarvis_speak4", "Ravi", "Headphones_test"))

            runBlocking { entry.notificationSettings().update { it.copy(headphonesOnly = false, excludedPackages = setOf("com.android.shell")) } }
            assertEquals(SpeakOutcome.Skipped("app is excluded"), postAndAwait("zarvis_speak5", "Ravi", "Excluded_test"))
            evidence("notification_speak live notification ${if (noEngine) "reached TTS (image has no engine -> Failed, reported honestly)" else "spoken"}; OTP/quiet hours/headphones/exclusion skipped")
        }
        runBlocking { entry.notificationSettings().update { it.copy(speakEnabled = false, excludedPackages = emptySet()) } }
        val off = turn("speak my notifications")
        assertEquals(ToolResultStatus.COMPLETED, off.result?.status)
        assertTrue(runBlocking { entry.notificationSettings().current().speakEnabled })
        assertEquals(ToolResultStatus.COMPLETED, turn("stop speaking notifications").result?.status)
        assertFalse(runBlocking { entry.notificationSettings().current().speakEnabled })
        evidence("notification_speak on/off by voice verified by read-back")
    }

    @Test
    fun c_revokingNotificationAccessIsDetectedAndEnforced() {
        runBlocking { entry.revocationDetector().check() } // records "granted"
        setListener(false)
        assertTrue(
            "listener state after revoking: ${state(PermissionType.NOTIFICATION_LISTENER)} setting=${shell("settings get secure enabled_notification_listeners").trim()}",
            eventually(15_000) { state(PermissionType.NOTIFICATION_LISTENER) == AccessState.SPECIAL_ACCESS_OFF },
        )
        val report = runBlocking { entry.revocationDetector().check() }
        assertTrue("revocation detected: $report", PermissionType.NOTIFICATION_LISTENER in report.revoked)
        val blocked = runBlocking {
            entry.toolPipeline().execute(ToolCall(skillId = "notifications.read_recent", input = SkillInput()), SkillExecutionContext("emulator-verification"))
        }
        assertEquals(listOf(PermissionType.NOTIFICATION_LISTENER), (blocked as ToolExecutionOutcome.PermissionDenied).missing)
        val viaTurn = turn("read my notifications")
        assertEquals(ToolResultStatus.DENIED, viaTurn.result?.status) // explanation shown, user chose Not now
        evidence("notification_read revoked -> detector=${report.revoked} pipeline=PermissionDenied turn=DENIED")
    }

    // --- usage_stats ---------------------------------------------------------------------

    @Test
    fun d_usageAccessReportsRealForegroundTime() {
        shell("appops set $APP GET_USAGE_STATS ignore")
        assertTrue(eventually { state(PermissionType.USAGE_ACCESS) == AccessState.SPECIAL_ACCESS_OFF })
        assertTrue(runBlocking { entry.toolPipeline().execute(ToolCall(skillId = "usage.screen_time", input = SkillInput()), SkillExecutionContext("v")) } is ToolExecutionOutcome.PermissionDenied)

        shell("appops set $APP GET_USAGE_STATS allow")
        assertTrue(eventually { state(PermissionType.USAGE_ACCESS) == AccessState.GRANTED })
        val clock = openClock()
        Thread.sleep(4_000)
        ui.pressHome()
        Thread.sleep(1_500)
        val report = runBlocking { entry.usageStats().todaySoFar() }
        assertTrue(report is UsageReport.Available)
        val clockUsage = (report as UsageReport.Available).apps.firstOrNull { it.packageName == clock }
        assertNotNull("foreground time recorded for $clock: ${report.apps}", clockUsage)
        assertTrue(clockUsage!!.foregroundMillis >= 2_000)
        val outcome = turn("what's my screen time today")
        assertEquals(ToolResultStatus.COMPLETED, outcome.result?.status)
        evidence("usage_stats clock=${clockUsage.foregroundMillis}ms turn=COMPLETED evidence=${outcome.result?.verificationEvidence}")

        shell("appops set $APP GET_USAGE_STATS ignore")
        assertTrue(eventually { state(PermissionType.USAGE_ACCESS) == AccessState.SPECIAL_ACCESS_OFF })
        evidence("usage_stats revoked via appops -> SPECIAL_ACCESS_OFF")
    }

    // --- accessibility + screen_interaction ------------------------------------------------

    private fun setAccessibility(enabled: Boolean) {
        if (enabled) {
            shell("settings put secure enabled_accessibility_services ${Device.accessibilityComponent}")
            shell("settings put secure accessibility_enabled 1")
        } else {
            shell("settings put secure enabled_accessibility_services null")
        }
    }

    @Test
    fun e_accessibilityGlobalActionsAndScreenInteraction() {
        val screen = entry.screenAccess()
        setAccessibility(true)
        assertTrue(eventually(15_000) { state(PermissionType.ACCESSIBILITY_SERVICE) == AccessState.GRANTED })
        assertTrue("service bound by Android", eventually(15_000) { screen.serviceConnected() })
        evidence("accessibility enabled -> service connected")

        // Read the app in front (the Clock), never ZARVIS itself.
        val clock = openClock()
        val target = runBlocking { screen.foregroundTarget() }
        assertEquals(clock, target?.packageName)
        val read = runBlocking { screen.readScreen(clock) }
        assertTrue(read is ScreenRead.Text && read.lines.isNotEmpty())
        evidence("screen_read $clock lines=${(read as ScreenRead.Text).lines.take(6)}")

        // Full pipeline: "tap Timer" is confirmed, performed and verified by a changed screen.
        val plan = runBlocking { screen.planTap("Timer") }
        assertTrue("Timer button found once: $plan", plan is TapPlan.Ready)
        val tapped = turn("tap Timer")
        assertEquals(tapped.message, ToolResultStatus.COMPLETED, tapped.result?.status)
        assertEquals("true", tapped.result?.verificationEvidence?.get("actionClickReturned"))
        evidence("screen_tap Timer -> ${tapped.message} evidence=${tapped.result?.verificationEvidence}")

        // Declining the confirmation does nothing.
        val before = ui.currentPackageName
        val declined = turn("go home", confirm = false)
        assertEquals(ToolResultStatus.DENIED, declined.result?.status)
        assertEquals(before, ui.currentPackageName)

        // Home, verified against the default launcher.
        val home = turn("go home")
        assertEquals(ToolResultStatus.COMPLETED, home.result?.status)
        assertEquals("true", home.result?.verificationEvidence?.get("verified"))
        evidence("global HOME -> ${home.result?.verificationEvidence}")

        val shade = runBlocking { screen.performGlobal(GlobalAction.NOTIFICATIONS) }
        assertTrue(shade.accepted)
        evidence("global NOTIFICATIONS -> $shade")
        runBlocking { screen.performGlobal(GlobalAction.BACK) }

        // Never inside Android Settings (a security surface), even when asked.
        shell("am start -W -a android.settings.SETTINGS")
        assertTrue(eventually { ui.currentPackageName == "com.android.settings" })
        val refused = turn("read my screen")
        assertEquals(ToolResultStatus.FAILED, refused.result?.status)
        assertTrue(refused.message, refused.message.contains("settings, permission or install screens"))
        val refusedTap = turn("tap Apps")
        assertEquals(ToolResultStatus.FAILED, refusedTap.result?.status)
        evidence("security surface com.android.settings -> read and tap refused")
        ui.pressHome()

        // Revocation: turning the service off unbinds it and blocks the pipeline.
        runBlocking { entry.revocationDetector().check() }
        setAccessibility(false)
        assertTrue(eventually(15_000) { !screen.serviceConnected() && state(PermissionType.ACCESSIBILITY_SERVICE) == AccessState.SPECIAL_ACCESS_OFF })
        assertTrue(PermissionType.ACCESSIBILITY_SERVICE in runBlocking { entry.revocationDetector().check() }.revoked)
        assertTrue(ZarvisAccessibilityService.connected == null)
        evidence("accessibility revoked -> unbound, detected, pipeline gated")
    }

    // --- default_assistant ---------------------------------------------------------------

    private fun setAssistant(holder: Boolean) {
        if (sdk >= 29) {
            shell("cmd role ${if (holder) "add-role-holder" else "remove-role-holder"} android.app.role.ASSISTANT $APP")
        } else if (holder) {
            shell("settings put secure assistant ${Device.assistComponent}")
        } else {
            shell("settings delete secure assistant")
        }
    }

    @Test
    fun f_defaultAssistantRoleAndAssistGesture() {
        setAssistant(false)
        assertTrue(eventually { state(PermissionType.ASSISTANT_ROLE) == AccessState.SPECIAL_ACCESS_OFF })
        setAssistant(true)
        assertTrue("Android reports ZARVIS as the assistant", eventually(10_000) { state(PermissionType.ASSISTANT_ROLE) == AccessState.GRANTED })
        val setup = turn("make zarvis my default assistant")
        assertEquals(ToolResultStatus.COMPLETED, setup.result?.status)
        evidence("default_assistant role held -> ${setup.result?.verificationEvidence}")

        ui.pressHome()
        shell("input keyevent KEYCODE_ASSIST")
        assertTrue("assist gesture brought ZARVIS to the front", eventually(15_000) { ui.currentPackageName == APP })
        // The overlay starts listening at once, so on a fresh install ZARVIS first explains the
        // microphone (§10). Answer Not now: the overlay must stay usable with typed input.
        ui.wait(Until.findObject(By.pkg(APP).text("Not now")), 5_000)?.click()
        val close = Device.waitFor(By.pkg(APP).text("Close"))
        assertNotNull("assist gesture opened ZARVIS's overlay", close)
        evidence("default_assistant KEYCODE_ASSIST -> AssistActivity shown over ${ui.launcherPackageName}")
        close!!.click()
        assertTrue("overlay closed", eventually(10_000) { ui.currentPackageName != APP })

        setAssistant(false)
        assertTrue(eventually { state(PermissionType.ASSISTANT_ROLE) == AccessState.SPECIAL_ACCESS_OFF })
        evidence("default_assistant removed -> SPECIAL_ACCESS_OFF")
    }

    @Test
    fun g_reopeningFromAnotherAppNeverStartsTheOverlayWithoutTheRole() {
        // Without the role, the assist gesture must not reach ZARVIS.
        setAssistant(false)
        ui.pressHome()
        shell("input keyevent KEYCODE_ASSIST")
        assertFalse(ui.wait(Until.hasObject(By.pkg(APP).text("Close")), 4_000) == true)
        ui.pressHome()
        app().startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        evidence("default_assistant not held -> assist gesture does not open ZARVIS")
    }

    private fun app() = Device.app
}
