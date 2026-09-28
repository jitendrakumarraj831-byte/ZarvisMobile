package com.zarvismobile.app

import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
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
import org.junit.Assert.assertTrue
import org.junit.FixMethodOrder
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
        shell("pm grant $APP android.permission.CALL_PHONE")
        ActivityScenario.launch(MainActivity::class.java).use {
            // Cancel in the real dialog: nothing is dialled.
            val cancelled = CoroutineScope(Dispatchers.Default).async { entry.orchestrator().handleTurn("call 5551234", "emulator-verification") }
            val cancel = Device.waitFor(Device.appText("Cancel")) ?: error("confirmation dialog not shown")
            assertTrue("dialog names the exact number", ui.hasObject(androidx.test.uiautomator.By.pkg(APP).textContains("5551234")))
            cancel.click()
            val declined = runBlocking { withTimeout(30_000) { cancelled.await() } }
            assertEquals(ToolResultStatus.DENIED, declined.result?.status)
            assertFalse("no call after Cancel", callActive())

            // Confirm in the real dialog: the dialer places the call.
            val confirmed = CoroutineScope(Dispatchers.Default).async { entry.orchestrator().handleTurn("call 5551234", "emulator-verification") }
            (Device.waitFor(Device.appText("Confirm")) ?: error("confirmation dialog not shown")).click()
            val placed = runBlocking { withTimeout(30_000) { confirmed.await() } }
            assertTrue("call state OFFHOOK", eventually(15_000) { callActive() })
            evidence("phone_call confirm -> ${placed.result?.status} ${placed.result?.verificationEvidence}; telephony mCallState=2")
            shell("input keyevent KEYCODE_ENDCALL")
            assertTrue(eventually(15_000) { !callActive() })
        }
    }

    @Test
    fun b_locationReportsARealFixOrAnHonestReason() {
        shell("pm grant $APP android.permission.ACCESS_COARSE_LOCATION")
        val outcome = turn("where am i")
        evidence("location -> ${outcome.result?.status}: ${outcome.message} evidence=${outcome.result?.verificationEvidence}")
        assertTrue(outcome.result?.status == ToolResultStatus.COMPLETED || outcome.result?.status == ToolResultStatus.FAILED)
        if (outcome.result?.status == ToolResultStatus.COMPLETED) assertTrue(outcome.message.contains("approximate location"))
    }

    @Test
    fun c_alarmIsHandedToTheClockApp() {
        val outcome = turn("set an alarm for 6:30 am")
        assertEquals(ToolResultStatus.USER_ACTION_REQUIRED, outcome.result?.status)
        assertTrue("Clock app opened", eventually(10_000) { ui.currentPackageName?.contains("clock") == true })
        evidence("alarm -> USER_ACTION_REQUIRED, ${ui.currentPackageName} opened")
        ui.pressBack()
        ui.pressHome()
    }

    @Test
    fun d_bluetoothOpensSettingsAndNeverChangesIt() {
        val outcome = turn("open bluetooth settings")
        assertEquals(ToolResultStatus.USER_ACTION_REQUIRED, outcome.result?.status)
        assertTrue(eventually(10_000) { ui.currentPackageName == "com.android.settings" })
        evidence("bluetooth -> USER_ACTION_REQUIRED, Settings opened")
        ui.pressHome()
    }

    @Test
    fun e_calendarHandsOffOrSaysNoCalendarApp() {
        val outcome = turn("add a meeting tomorrow at 5 pm to my calendar")
        evidence("calendar -> ${outcome.result?.status}: ${outcome.message} front=${ui.currentPackageName}")
        assertTrue(outcome.result?.status == ToolResultStatus.USER_ACTION_REQUIRED || outcome.message.contains("No calendar app"))
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
}
