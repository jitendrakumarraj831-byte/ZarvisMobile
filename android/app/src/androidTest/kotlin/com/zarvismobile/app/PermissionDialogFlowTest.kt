package com.zarvismobile.app

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.Until
import com.zarvismobile.app.Device.appText
import com.zarvismobile.app.Device.entry
import com.zarvismobile.app.Device.evidence
import com.zarvismobile.app.Device.sdk
import com.zarvismobile.app.Device.ui
import com.zarvismobile.app.Device.waitFor
import com.zarvismobile.domain.access.AccessResult
import com.zarvismobile.domain.access.AccessState
import com.zarvismobile.domain.capability.CapabilityId
import com.zarvismobile.domain.entity.PermissionType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters

/**
 * Phase A (fresh install): the blueprint §10 permission flow against Android's REAL runtime
 * permission dialogs — ZARVIS's explanation first (Allow / Not now / Learn more), then the
 * system dialog, then the state Android actually reports.
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class PermissionDialogFlowTest {
    @get:Rule val guard = verificationGuard()

    private lateinit var scenario: ActivityScenario<MainActivity>
    private val registry get() = entry.capabilityRegistry()

    @Before
    fun launch() {
        scenario = ActivityScenario.launch(MainActivity::class.java)
    }

    @After
    fun close() {
        scenario.close()
    }

    private fun ensureAsync(id: CapabilityId, permissions: List<PermissionType>? = null): Deferred<AccessResult> =
        CoroutineScope(Dispatchers.Default).async {
            val capability = registry.get(id)
            entry.accessCoordinator().ensure(capability, permissions ?: capability.permissionTypes)
        }

    private fun <T> await(deferred: Deferred<T>): T = runBlocking { withTimeout(30_000) { deferred.await() } }

    private fun state(permission: PermissionType) = runBlocking { entry.deviceAccessPort().state(permission) }

    private fun click(text: String) {
        val node = waitFor(appText(text)) ?: error("\"$text\" not shown")
        node.click()
    }

    @Test
    fun a_notNowShowsNoSystemDialogAndChangesNothing() {
        assertEquals(AccessState.NOT_REQUESTED, state(PermissionType.CONTACTS))
        val result = ensureAsync(CapabilityId.CONTACTS)
        assertNotNull("ZARVIS explanation shown first", waitFor(appText("Allow contacts?")))
        click("Not now")
        assertTrue(await(result) is AccessResult.Declined)
        assertFalse("no Android dialog after Not now", ui.wait(Until.hasObject(Device.anySystemPermissionDialog()), 2_000) == true)
        assertEquals(AccessState.NOT_REQUESTED, state(PermissionType.CONTACTS))
        evidence("permission_flow contacts not_now -> Declined, no system dialog, state=NOT_REQUESTED")
    }

    @Test
    fun b_learnMoreThenDenyInTheRealDialogIsVerifiedDenied() {
        val result = ensureAsync(CapabilityId.CONTACTS)
        click("Learn more")
        assertNotNull("Learn more expands the details", waitFor(appText("Data exposure")))
        click("Allow")
        val deny = waitFor(Device.systemDenyButton()) ?: error("Android permission dialog not shown")
        deny.click()
        val denied = await(result)
        assertTrue(denied is AccessResult.Denied && !denied.permanently)
        assertEquals(AccessState.DENIED, state(PermissionType.CONTACTS))
        evidence("permission_flow contacts learn_more+deny -> Denied(permanently=false), state=DENIED")
    }

    @Test
    fun c_allowInTheRealDialogIsVerifiedGranted() {
        val result = ensureAsync(CapabilityId.CONTACTS)
        click("Allow")
        (waitFor(Device.systemAllowButton()) ?: error("Android permission dialog not shown")).click()
        assertEquals(AccessResult.Granted, await(result))
        assertEquals(AccessState.GRANTED, state(PermissionType.CONTACTS))
        evidence("permission_flow contacts allow -> Granted, state=GRANTED")
    }

    @Test
    fun d_permanentDenialLeadsToSettingsAndStaysDenied() {
        // First denial.
        val first = ensureAsync(CapabilityId.PHONE_CALL)
        click("Allow")
        (waitFor(Device.systemDenyButton()) ?: error("dialog 1 not shown")).click()
        assertTrue(await(first) is AccessResult.Denied)

        // Second denial: "don't ask again" (checkbox on Android 8–10, second deny on 11+).
        val second = ensureAsync(CapabilityId.PHONE_CALL)
        click("Allow")
        waitFor(Device.systemDenyButton()) ?: error("dialog 2 not shown")
        ui.findObject(Device.systemDontAskAgainCheckbox())?.click()
        ui.findObject(Device.systemDenyButton()).click()
        val secondResult = await(second)
        assertTrue(secondResult is AccessResult.Denied && secondResult.permanently)
        assertEquals(AccessState.PERMANENTLY_DENIED, state(PermissionType.PHONE_CALL))

        // Now only Settings can grant it: ZARVIS says so and opens the app's Settings page.
        val third = ensureAsync(CapabilityId.PHONE_CALL)
        click("Open settings")
        assertTrue("Android Settings opened", ui.wait(Until.hasObject(androidx.test.uiautomator.By.pkg("com.android.settings")), 10_000) == true)
        ui.pressBack()
        val thirdResult = await(third)
        assertTrue(thirdResult is AccessResult.Denied && thirdResult.permanently)
        evidence("permission_flow phone deny x2 -> PERMANENTLY_DENIED; Open settings -> com.android.settings; still denied after return")
    }

    @Test
    fun e_notificationsFollowTheAndroidVersion() {
        if (sdk < 33) {
            // Android 8–12: no runtime permission; the app-level switch decides.
            assertEquals(AccessState.GRANTED, state(PermissionType.NOTIFICATIONS))
            val result = ensureAsync(CapabilityId.ALARMS, listOf(PermissionType.NOTIFICATIONS))
            assertEquals(AccessResult.Granted, await(result))
            assertFalse(ui.wait(Until.hasObject(appText("Not now")), 1_500) == true)
            evidence("notifications sdk<33 -> no runtime permission, areNotificationsEnabled=GRANTED, no prompt")
        } else {
            assertEquals(AccessState.NOT_REQUESTED, state(PermissionType.NOTIFICATIONS))
            val result = ensureAsync(CapabilityId.ALARMS, listOf(PermissionType.NOTIFICATIONS))
            click("Allow")
            (waitFor(Device.systemAllowButton()) ?: error("POST_NOTIFICATIONS dialog not shown")).click()
            assertEquals(AccessResult.Granted, await(result))
            evidence("notifications sdk>=33 -> POST_NOTIFICATIONS dialog -> Granted")
        }
    }

    @Test
    fun f_microphoneDeniedKeepsTextInput() {
        val result = ensureAsync(CapabilityId.MICROPHONE)
        click("Allow")
        (waitFor(Device.systemDenyButton()) ?: error("mic dialog not shown")).click()
        assertTrue(await(result) is AccessResult.Denied)
        assertEquals(AccessState.DENIED, state(PermissionType.MICROPHONE))
        evidence("permission_flow microphone deny -> Denied, state=DENIED")
    }
}
