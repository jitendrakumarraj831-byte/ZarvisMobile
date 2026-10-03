package com.zarvismobile.domain.capability

import com.zarvismobile.domain.entity.CapabilityStatus
import com.zarvismobile.domain.entity.PermissionType
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CapabilityRegistryTest {
    private val registry = CapabilityRegistry.loadDefault()

    @Test
    fun `the packaged registry is the shared JSON the backend serves`() {
        val shared = File("../../shared/capability-registry.json").readText()
        val ids = Json.parseToJsonElement(shared).jsonObject.getValue("capabilities").jsonArray.map { it.jsonObject.getValue("id").jsonPrimitive.content }
        assertEquals(ids, registry.capabilities.map { it.id.wireId })
    }

    @Test
    fun `defines all 16 blueprint capabilities`() {
        assertEquals(CapabilityId.entries.toSet(), registry.capabilities.map { it.id }.toSet())
    }

    @Test
    fun `no Android capability claims WORKING without device verification`() {
        assertTrue(registry.capabilities.none { it.android.status == CapabilityStatus.WORKING })
    }

    @Test
    fun `each declared confirmation policy agrees with the action policy`() {
        for (c in registry.capabilities) {
            assertEquals(c.confirmation == ConfirmationPolicy.PER_ACTION, ActionPolicy.requiresConfirmation(c.actionClass, c.risk), c.id.wireId)
        }
    }

    @Test
    fun `runtime permissions map to the pipeline's permission types`() {
        assertEquals(listOf(PermissionType.PHONE_CALL), registry.get(CapabilityId.PHONE_CALL).permissionTypes)
        assertEquals(listOf(PermissionType.NOTIFICATIONS), registry.get(CapabilityId.ALARMS).permissionTypes)
        assertEquals(listOf(PermissionType.LOCATION), registry.get(CapabilityId.LOCATION).permissionTypes)
        assertTrue(registry.get(CapabilityId.CAMERA).permissionTypes.isEmpty(), "camera uses the system camera app, no CAMERA permission")
    }

    @Test
    fun `special access capabilities map to their settings-only permission types`() {
        assertEquals(listOf(PermissionType.NOTIFICATION_LISTENER), registry.get(CapabilityId.NOTIFICATION_READ).permissionTypes)
        assertEquals(listOf(PermissionType.NOTIFICATION_LISTENER), registry.get(CapabilityId.NOTIFICATION_SPEAK).permissionTypes)
        assertEquals(listOf(PermissionType.ACCESSIBILITY_SERVICE), registry.get(CapabilityId.ACCESSIBILITY).permissionTypes)
        assertEquals(listOf(PermissionType.ACCESSIBILITY_SERVICE), registry.get(CapabilityId.SCREEN_INTERACTION).permissionTypes)
        assertEquals(listOf(PermissionType.USAGE_ACCESS), registry.get(CapabilityId.USAGE_STATS).permissionTypes)
        assertEquals(listOf(PermissionType.ASSISTANT_ROLE), registry.get(CapabilityId.DEFAULT_ASSISTANT).permissionTypes)
        assertTrue(registry.capabilities.flatMap { it.permissionTypes }.filter { it.specialAccess }.toSet() ==
            PermissionType.entries.filter { it.specialAccess }.toSet())
    }

    @Test
    fun `every capability is implemented or explicitly unsupported on Android - none left planned`() {
        registry.capabilities.forEach { capability ->
            assertTrue(capability.android.status != CapabilityStatus.PLANNED, "${capability.id} is still PLANNED")
            assertTrue(capability.android.note.isNotBlank())
        }
    }
}
