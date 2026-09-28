package com.zarvismobile.domain.access

import com.zarvismobile.domain.capability.CapabilityId
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.capability.PlatformState
import com.zarvismobile.domain.entity.CapabilityStatus
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
        val settingsTargets = mutableListOf<SettingsTarget>()
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
        settings = AppSettingsPort { target ->
            recorder.settingsOpened++
            recorder.settingsTargets += target
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
        val planned = contacts.copy(android = PlatformState(CapabilityStatus.PLANNED, "Not in this build."))
        val result = coordinator(FakeAndroid(mutableMapOf()), RationaleChoice.ALLOW, r).ensure(planned)
        assertIs<AccessResult.Unsupported>(result)
        assertTrue(r.rationales.isEmpty())
    }

    private val notificationRead = registry.get(CapabilityId.NOTIFICATION_READ)

    @Test
    fun `special access - explained, then its own settings page, never a runtime dialog, verified granted`() = runTest {
        val r = Recorder()
        val android = FakeAndroid(mutableMapOf(PermissionType.NOTIFICATION_LISTENER to AccessState.SPECIAL_ACCESS_OFF))
        val result = coordinator(android, RationaleChoice.ALLOW, r, userGrantsInSettings = true).ensure(notificationRead)
        assertIs<AccessResult.Granted>(result)
        val rationale = r.rationales.single()
        assertTrue(rationale.requiresSettings)
        assertEquals(SettingsReason.SPECIAL_ACCESS, rationale.settingsReason)
        assertEquals(listOf(SettingsTarget.NOTIFICATION_LISTENER), r.settingsTargets)
        assertEquals(0, r.systemRequests)
    }

    @Test
    fun `special access - Not now opens nothing`() = runTest {
        val r = Recorder()
        val android = FakeAndroid(mutableMapOf(PermissionType.ACCESSIBILITY_SERVICE to AccessState.SPECIAL_ACCESS_OFF))
        val result = coordinator(android, RationaleChoice.NOT_NOW, r).ensure(registry.get(CapabilityId.ACCESSIBILITY))
        assertIs<AccessResult.Declined>(result)
        assertTrue(r.settingsTargets.isEmpty() && r.systemRequests == 0)
    }

    @Test
    fun `special access - returning from settings without turning it on is denied, not trusted`() = runTest {
        val r = Recorder()
        val android = FakeAndroid(mutableMapOf(PermissionType.USAGE_ACCESS to AccessState.SPECIAL_ACCESS_OFF))
        val result = coordinator(android, RationaleChoice.ALLOW, r, userGrantsInSettings = false).ensure(registry.get(CapabilityId.USAGE_STATS))
        assertIs<AccessResult.Denied>(result)
        assertTrue(result.permanently)
        assertEquals(listOf(SettingsTarget.USAGE_ACCESS), r.settingsTargets)
    }

    @Test
    fun `assistant role opens the default apps page`() = runTest {
        val r = Recorder()
        val android = FakeAndroid(mutableMapOf(PermissionType.ASSISTANT_ROLE to AccessState.SPECIAL_ACCESS_OFF))
        coordinator(android, RationaleChoice.ALLOW, r, userGrantsInSettings = true).ensure(registry.get(CapabilityId.DEFAULT_ASSISTANT))
        assertEquals(listOf(SettingsTarget.DEFAULT_ASSISTANT), r.settingsTargets)
    }

    @Test
    fun `unavailable on this device is unsupported with a reason and no prompt`() = runTest {
        val r = Recorder()
        val android = FakeAndroid(mutableMapOf(PermissionType.ASSISTANT_ROLE to AccessState.UNAVAILABLE))
        val result = coordinator(android, RationaleChoice.ALLOW, r).ensure(registry.get(CapabilityId.DEFAULT_ASSISTANT))
        assertIs<AccessResult.Unsupported>(result)
        assertTrue(result.reason!!.contains("Android version"))
        assertTrue(r.rationales.isEmpty() && r.settingsTargets.isEmpty())
    }

    @Test
    fun `notifications switched off below Android 13 open the app notification page`() = runTest {
        val r = Recorder()
        val reminders = registry.get(CapabilityId.ALARMS)
        val android = FakeAndroid(mutableMapOf(PermissionType.NOTIFICATIONS to AccessState.SYSTEM_DISABLED))
        coordinator(android, RationaleChoice.ALLOW, r, userGrantsInSettings = true).ensure(reminders, listOf(PermissionType.NOTIFICATIONS))
        assertEquals(listOf(SettingsTarget.APP_NOTIFICATIONS), r.settingsTargets)
        assertEquals(SettingsReason.SYSTEM_SWITCH_OFF, r.rationales.single().settingsReason)
    }
}
