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
    fun `planned capabilities are not implemented on Android`() {
        assertTrue(!registry.get(CapabilityId.NOTIFICATION_READ).implementedOnAndroid)
        assertTrue(registry.get(CapabilityId.CONTACTS).implementedOnAndroid)
    }
}
