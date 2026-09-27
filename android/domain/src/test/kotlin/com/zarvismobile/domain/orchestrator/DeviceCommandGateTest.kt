package com.zarvismobile.domain.orchestrator

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DeviceCommandGateTest {
    @Test
    fun `accepts a direct open-app command`() {
        assertTrue(DeviceCommandGate.accepts("phone.open_app", "Open WhatsApp"))
    }

    @Test
    fun `rejects open used as ordinary language`() {
        assertFalse(DeviceCommandGate.accepts("phone.open_app", "open this topic"))
    }

    @Test
    fun `accepts a raw-number call`() {
        assertTrue(DeviceCommandGate.accepts("phone.call", "Call 9876543210"))
    }

    @Test
    fun `rejects call it a day`() {
        assertFalse(DeviceCommandGate.accepts("phone.call", "call it a day"))
    }

    @Test
    fun `accepts a reminder without treating the later word call as a phone command`() {
        assertTrue(DeviceCommandGate.accepts("personal.reminder", "please remind me to call mom"))
        assertFalse(DeviceCommandGate.accepts("phone.call", "please remind me to call mom"))
    }
}
