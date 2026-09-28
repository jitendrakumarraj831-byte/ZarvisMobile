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

    @Test
    fun `questions about a topic are not device commands`() {
        assertFalse(DeviceCommandGate.accepts("bluetooth.open_settings", "how does bluetooth work"))
        assertFalse(DeviceCommandGate.accepts("alarm.set", "what is an alarm clock"))
        assertFalse(DeviceCommandGate.accepts("camera.capture_photo", "what camera does this phone have"))
    }

    @Test
    fun `device commands are accepted`() {
        assertTrue(DeviceCommandGate.accepts("bluetooth.open_settings", "open bluetooth settings"))
        assertTrue(DeviceCommandGate.accepts("alarm.set", "set an alarm for 6 am"))
        assertTrue(DeviceCommandGate.accepts("location.current", "where am i"))
        assertTrue(DeviceCommandGate.accepts("calendar.create_event", "add meeting to my calendar tomorrow at 5 pm"))
        assertTrue(DeviceCommandGate.accepts("personal.reminder", "show my reminders"))
    }

    @Test
    fun `open wifi settings is not treated as opening an app`() {
        assertFalse(DeviceCommandGate.accepts("phone.open_app", "open wifi settings"))
    }
}
