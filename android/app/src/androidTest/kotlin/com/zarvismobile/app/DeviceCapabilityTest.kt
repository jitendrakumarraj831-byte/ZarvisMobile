package com.zarvismobile.app

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.Settings
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.zarvismobile.agents.TurnOutcome
import com.zarvismobile.app.Device.APP
import com.zarvismobile.app.Device.awaitSystemReady
import com.zarvismobile.app.Device.entry
import com.zarvismobile.app.Device.evidence
import com.zarvismobile.app.Device.eventually
import com.zarvismobile.app.Device.sdk
import com.zarvismobile.app.Device.shell
import com.zarvismobile.app.Device.ui
import com.zarvismobile.domain.access.RationaleChoice
import com.zarvismobile.domain.entity.ToolResultStatus
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
import org.junit.Assume
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters

/**
 * Phase D (continued): the runtime-permission and hand-off capabilities, executed for real on
 * the emulator — a call is actually placed after the user taps Confirm in ZARVIS's own dialog,
 * a reminder notification is actually delivered, hand-offs actually open the system app.
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class DeviceCapabilityTest {
    @get:Rule val guard = verificationGuard()

    private fun turn(utterance: String, confirm: Boolean? = true): TurnOutcome = runBlocking {
        val responders = CoroutineScope(Dispatchers.Default)
        if (confirm != null) responders.launch { entry.confirmationPort().pending.filterNotNull().collect { it.respond(confirm) } }
        responders.launch { entry.rationalePort().pending.filterNotNull().collect { it.respond(RationaleChoice.NOT_NOW) } }
        try {
            withTimeout(60_000) { entry.orchestrator().handleTurn(utterance, accountId = "emulator-verification") }
        } finally {
            responders.cancel()
        }
    }

    private fun callActive() = shell("dumpsys telephony.registry").contains("mCallState=2")

    @Test
    fun a_callIsPlacedOnlyAfterTappingConfirmInZarvisDialog() {
        // On a physical phone this places a real call, so it only runs with a number its owner
        // supplied (`-e callNumber …`, e.g. their own second phone); otherwise nothing is dialled
        // and the capability is recorded as unverified on this device.
        val number = Device.arg("callNumber") ?: if (Device.isEmulator) "5551234" else null
        if (number == null) {
            evidence("phone_call UNVERIFIED on this physical device: no test number given (-e callNumber); no call placed")
            Assume.assumeTrue("no test number for a real call", false)
        }
        number!!
        shell("pm grant $APP android.permission.CALL_PHONE")
        ActivityScenario.launch(MainActivity::class.java).use {
            // Cancel in the real dialog: nothing is dialled.
            val cancelled = CoroutineScope(Dispatchers.Default).async { entry.orchestrator().handleTurn("call $number", "emulator-verification") }
            val cancel = Device.waitFor(Device.appText("Cancel")) ?: error("confirmation dialog not shown")
            assertTrue("dialog names the exact number", ui.hasObject(androidx.test.uiautomator.By.pkg(APP).textContains(number)))
            cancel.click()
            val declined = runBlocking { withTimeout(30_000) { cancelled.await() } }
            assertEquals(ToolResultStatus.DENIED, declined.result?.status)
            assertFalse("no call after Cancel", callActive())

            // Confirm in the real dialog: the dialer places the call.
            val confirmed = CoroutineScope(Dispatchers.Default).async { entry.orchestrator().handleTurn("call $number", "emulator-verification") }
            (Device.waitFor(Device.appText("Confirm")) ?: error("confirmation dialog not shown")).click()
            val placed = runBlocking { withTimeout(30_000) { confirmed.await() } }
            assertTrue("call state OFFHOOK", eventually(15_000) { callActive() })
            val shown = if (Device.isEmulator) placed.result?.verificationEvidence.toString() else "{number=<redacted>}"
            evidence("phone_call confirm -> ${placed.result?.status} $shown; telephony mCallState=2")
            shell("input keyevent KEYCODE_ENDCALL")
            assertTrue(eventually(15_000) { !callActive() })
        }
    }

    @Test
    fun b_locationReportsARealFixOrAnHonestReason() {
        shell("pm grant $APP android.permission.ACCESS_COARSE_LOCATION")
        val outcome = turn("where am i")
        // A phone's real position never goes into the logs.
        val redact = { text: String -> if (Device.isEmulator) text else text.replace(Regex("""-?\d{1,3}\.\d+"""), "<redacted>") }
        evidence("location -> ${outcome.result?.status}: ${redact(outcome.message)} evidence=${redact(outcome.result?.verificationEvidence.toString())}")
        evidence("location fix_obtained=${outcome.result?.status == ToolResultStatus.COMPLETED} on ${if (Device.isEmulator) "emulator" else "physical device"}")
        assertTrue(outcome.result?.status == ToolResultStatus.COMPLETED || outcome.result?.status == ToolResultStatus.FAILED)
        if (outcome.result?.status == ToolResultStatus.COMPLETED) assertTrue(outcome.message.contains("approximate location"))
    }

    /**
     * Which apps on this device can handle the intent, asked of the package manager as the
     * shell (the app's own query would be filtered by Android 11+ package visibility).
     */
    private fun handlers(action: String, data: String? = null, type: String? = null): List<String> {
        val args = buildString {
            append("-a $action")
            data?.let { append(" -d $it") }
            type?.let { append(" -t $it") }
        }
        val out = shell("cmd package query-activities $args -c android.intent.category.DEFAULT")
        return Regex("""packageName=([A-Za-z0-9_.]+)""").findAll(out).map { it.groupValues[1] }.distinct().toList()
            .also { if (it.isEmpty()) Device.diagnose("no handler for $args: ${out.take(300)}") }
    }

    /** The app Android put in front — or, when several apps qualify, its own "Open with" chooser. */
    private fun handedOffTo(expected: List<String>): String? {
        var front: String? = null
        eventually(10_000) {
            front = ui.currentPackageName
            front in expected || (expected.size > 1 && front == "android")
        }
        return front?.takeIf { it in expected || (expected.size > 1 && it == "android") }
    }

    @Test
    fun c_alarmIsHandedToTheClockApp() {
        val clocks = handlers(AlarmClock.ACTION_SET_ALARM)
        val outcome = turn("set an alarm for 6:30 am")
        assertEquals(outcome.message, ToolResultStatus.USER_ACTION_REQUIRED, outcome.result?.status)
        val front = handedOffTo(clocks)
        assertNotNull("clock app (one of $clocks) opened; front=${ui.currentPackageName}", front)
        evidence("alarm -> USER_ACTION_REQUIRED, handed to $front (handlers=$clocks)")
        ui.pressBack()
        ui.pressHome()
    }

    @Test
    fun d_bluetoothOpensSettingsAndNeverChangesIt() {
        val settings = handlers(Settings.ACTION_BLUETOOTH_SETTINGS)
        val outcome = turn("open bluetooth settings")
        if (settings.isEmpty()) {
            // This image has no Bluetooth settings page (no Bluetooth hardware): ZARVIS must say
            // so instead of claiming it opened anything.
            assertEquals(outcome.message, ToolResultStatus.FAILED, outcome.result?.status)
            evidence("bluetooth -> FAILED honestly (no ACTION_BLUETOOTH_SETTINGS handler on this device): ${outcome.message}")
        } else {
            assertEquals(outcome.message, ToolResultStatus.USER_ACTION_REQUIRED, outcome.result?.status)
            assertTrue("Settings opened; front=${ui.currentPackageName}", eventually(10_000) { ui.currentPackageName in settings })
            evidence("bluetooth -> USER_ACTION_REQUIRED, ${ui.currentPackageName} opened")
        }
        ui.pressHome()
    }

    @Test
    fun e_calendarHandsOffOrSaysNoCalendarApp() {
        val calendars = handlers(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI.toString(), "vnd.android.cursor.dir/event")
        val outcome = turn("add a meeting tomorrow at 5 pm to my calendar")
        if (calendars.isEmpty()) {
            assertTrue(outcome.message, outcome.message.contains("No calendar app"))
            evidence("calendar -> no calendar app on this device, said so: ${outcome.message}")
        } else {
            assertEquals(outcome.message, ToolResultStatus.USER_ACTION_REQUIRED, outcome.result?.status)
            val front = handedOffTo(calendars)
            assertNotNull("calendar app (one of $calendars) opened; front=${ui.currentPackageName}", front)
            evidence("calendar -> USER_ACTION_REQUIRED, handed to $front (handlers=$calendars)")
        }
        ui.pressBack()
        ui.pressHome()
    }

    @Test
    fun f_reminderNotificationIsActuallyDelivered() {
        if (sdk >= 33) shell("pm grant $APP android.permission.POST_NOTIFICATIONS")
        // Exact timing on Android 12+ needs "Alarms & reminders" (granted by default only on 12).
        if (sdk >= 31) shell("appops set $APP SCHEDULE_EXACT_ALARM allow")
        val outcome = turn("remind me to drink water in 1 minute")
        assertEquals(outcome.message, ToolResultStatus.COMPLETED, outcome.result?.status)
        val manager = Device.app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val delivered = eventually(150_000, stepMs = 2_000) {
            manager.activeNotifications.any { n ->
                listOfNotNull(n.notification.extras.getCharSequence("android.title"), n.notification.extras.getCharSequence("android.text"))
                    .any { it.toString().contains("drink water", ignoreCase = true) }
            }
        }
        assertTrue("reminder notification posted by Android on API $sdk", delivered)
        evidence("reminder -> notification delivered on sdk=$sdk")
    }

    /**
     * Files / photos / camera: the request must open Android's own picker or camera app (never
     * ZARVIS-drawn UI), and backing out of it — the user picked nothing — must come back as an
     * honest non-success with nothing read, never as COMPLETED. If this device has no such app,
     * ZARVIS must say so (FAILED/UNSUPPORTED), which is also accepted. Selecting a real file,
     * photo or taking a picture is a manual check on a physical phone.
     */
    private fun systemUiThenBack(utterance: String, label: String) {
        ActivityScenario.launch(MainActivity::class.java).use {
            eventually(15_000) { ui.currentPackageName == APP } // ZARVIS is in front before the turn starts
            val pending = CoroutineScope(Dispatchers.Default).async { entry.orchestrator().handleTurn(utterance, "emulator-verification") }
            val opened = eventually(15_000) { ui.currentPackageName.let { it != null && it != APP && !pending.isCompleted } }
            if (opened) awaitSystemReady(5_000) // a crash dialog is not the picker; read what is really in front
            val front = ui.currentPackageName
            if (opened) {
                // Leave without choosing anything, the way a user cancels. An Android crash dialog
                // (the API 26 image's System UI) can cover the picker; it is dismissed first, as a
                // user would, and Back is pressed again until ZARVIS has the result.
                eventually(25_000, stepMs = 1_500) {
                    awaitSystemReady(5_000)
                    if (!pending.isCompleted && ui.currentPackageName != APP) ui.pressBack()
                    pending.isCompleted
                }
            }
            val outcome = try {
                runBlocking { withTimeout(10_000) { pending.await() } }
            } finally {
                // Leave no picker/camera behind for the next test (only if it is still in front).
                front?.takeIf { opened && it == ui.currentPackageName && it != APP && it != "android" && it != "com.android.systemui" }
                    ?.let { shell("am force-stop $it"); evidence("$label: $it was still open after the result; force-stopped") }
            }
            val status = outcome.result?.status
            assertTrue("$label: never COMPLETED without a choice (got $status: ${outcome.message})", status != ToolResultStatus.COMPLETED)
            if (opened) {
                assertEquals(outcome.message, ToolResultStatus.FAILED, status)
                evidence("$label -> system UI $front opened; backed out -> $status: ${outcome.message}")
            } else {
                assertTrue("$label: no system UI opened, so ZARVIS must say it is unavailable (got $status)", status == ToolResultStatus.FAILED || status == ToolResultStatus.UNSUPPORTED)
                evidence("$label -> no handler on this device, said so: $status: ${outcome.message}")
            }
        }
        ui.pressHome()
    }

    @Test
    fun g_filePickerOpensTheSystemPickerAndCancelIsNotASuccess() = systemUiThenBack("pick a file", "files")

    @Test
    fun h_photoPickerOpensTheSystemPickerAndCancelIsNotASuccess() = systemUiThenBack("pick a photo", "photos")

    @Test
    fun i_cameraOpensTheCameraAppAndCancelIsNotASuccess() = systemUiThenBack("take a photo", "camera")
}
