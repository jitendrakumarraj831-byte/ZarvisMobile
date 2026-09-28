package com.zarvismobile.domain.access

import com.zarvismobile.domain.capability.CapabilityId
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.entity.PermissionType
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class AccessCoordinatorTest {
    private val registry = CapabilityRegistry.loadDefault()
    private val contacts = registry.get(CapabilityId.CONTACTS)

    /** Simulates Android: state per permission, mutated by the "system dialog" / "settings". */
    private class FakeAndroid(var states: MutableMap<PermissionType, AccessState>) : DeviceAccessPort {
        override suspend fun state(permission: PermissionType) = states[permission] ?: AccessState.NOT_REQUIRED
    }

    private class Recorder {
        val rationales = mutableListOf<RationaleRequest>()
        var systemRequests = 0
        var settingsOpened = 0
    }

    private fun coordinator(
        android: FakeAndroid,
        choice: RationaleChoice,
        recorder: Recorder,
        userGrantsInDialog: Boolean = false,
        userGrantsInSettings: Boolean = false,
    ) = AccessCoordinator(
        device = android,
        rationale = RationalePort { recorder.rationales += it; choice },
        requester = SystemPermissionRequester { perms ->
            recorder.systemRequests++
            perms.forEach { android.states[it] = if (userGrantsInDialog) AccessState.GRANTED else AccessState.DENIED }
        },
        settings = AppSettingsPort {
            recorder.settingsOpened++
            if (userGrantsInSettings) android.states.replaceAll { _, _ -> AccessState.GRANTED }
        },
    )

    @Test
    fun `already granted skips every prompt`() = runTest {
        val r = Recorder()
        val result = coordinator(FakeAndroid(mutableMapOf(PermissionType.CONTACTS to AccessState.GRANTED)), RationaleChoice.ALLOW, r).ensure(contacts)
        assertIs<AccessResult.Granted>(result)
        assertTrue(r.rationales.isEmpty() && r.systemRequests == 0)
    }

    @Test
    fun `happy path - explain, Allow, system dialog, verified granted`() = runTest {
        val r = Recorder()
        val result = coordinator(FakeAndroid(mutableMapOf(PermissionType.CONTACTS to AccessState.NOT_REQUESTED)), RationaleChoice.ALLOW, r, userGrantsInDialog = true)
            .ensure(contacts)
        assertIs<AccessResult.Granted>(result)
        assertEquals("contacts", r.rationales.single().capabilityId)
        assertEquals(1, r.systemRequests)
    }

    @Test
    fun `Not Now never shows the system dialog`() = runTest {
        val r = Recorder()
        val result = coordinator(FakeAndroid(mutableMapOf(PermissionType.CONTACTS to AccessState.NOT_REQUESTED)), RationaleChoice.NOT_NOW, r).ensure(contacts)
        assertIs<AccessResult.Declined>(result)
        assertEquals(0, r.systemRequests)
    }

    @Test
    fun `denied in the system dialog is verified as denied, not trusted as granted`() = runTest {
        val r = Recorder()
        val result = coordinator(FakeAndroid(mutableMapOf(PermissionType.CONTACTS to AccessState.NOT_REQUESTED)), RationaleChoice.ALLOW, r, userGrantsInDialog = false)
            .ensure(contacts)
        val denied = assertIs<AccessResult.Denied>(result)
        assertEquals(listOf(PermissionType.CONTACTS), denied.missing)
        assertTrue(!denied.permanently)
    }

    @Test
    fun `permanently denied routes to Settings and re-verifies on return`() = runTest {
        val r = Recorder()
        val android = FakeAndroid(mutableMapOf(PermissionType.CONTACTS to AccessState.PERMANENTLY_DENIED))
        val stillDenied = coordinator(android, RationaleChoice.ALLOW, r, userGrantsInSettings = false).ensure(contacts)
        assertTrue(assertIs<AccessResult.Denied>(stillDenied).permanently)
        assertTrue(r.rationales.single().requiresSettings)
        assertEquals(0, r.systemRequests)
        assertEquals(1, r.settingsOpened)

        val granted = coordinator(android, RationaleChoice.ALLOW, Recorder(), userGrantsInSettings = true).ensure(contacts)
        assertIs<AccessResult.Granted>(granted)
    }

    @Test
    fun `notifications disabled at system level on Android 8-12 routes to Settings`() = runTest {
        val r = Recorder()
        val alarms = registry.get(CapabilityId.ALARMS)
        val result = coordinator(FakeAndroid(mutableMapOf(PermissionType.NOTIFICATIONS to AccessState.SYSTEM_DISABLED)), RationaleChoice.ALLOW, r, userGrantsInSettings = true)
            .ensure(alarms)
        assertIs<AccessResult.Granted>(result)
        assertEquals(1, r.settingsOpened)
    }

    @Test
    fun `a planned capability is reported unsupported without prompting`() = runTest {
        val r = Recorder()
        val result = coordinator(FakeAndroid(mutableMapOf()), RationaleChoice.ALLOW, r).ensure(registry.get(CapabilityId.NOTIFICATION_READ))
        assertIs<AccessResult.Unsupported>(result)
        assertTrue(r.rationales.isEmpty())
    }
}
