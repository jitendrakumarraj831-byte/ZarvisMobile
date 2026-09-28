package com.zarvismobile.domain.skill

import com.zarvismobile.domain.FixedClockPort
import com.zarvismobile.domain.entity.SkillExecutionContext
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.entity.SkillResult
import com.zarvismobile.domain.entity.ToolExecutionOutcome
import com.zarvismobile.domain.entity.ToolResultStatus
import com.zarvismobile.domain.result.ToolResults
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class DeviceCapabilitySkillsTest {
    private val context = SkillExecutionContext("acc-1")
    private val now = Instant.parse("2026-08-26T04:30:00Z") // 10:00 IST
    private val clock = FixedClockPort(now)
    private val zone = { ZoneId.of("Asia/Kolkata") }

    @Test
    fun `picking a document reports only metadata and the granted uri as evidence`() = runTest {
        val skill = DeviceCapabilitySkills.pickDocument { PickResult.Picked("report.pdf", "application/pdf", 2048, "content://doc/1") }
        val success = assertIs<SkillResult.Success>(skill.handler.execute(SkillInput(), context))
        assertTrue(success.summary.contains("report.pdf") && success.summary.contains("not uploaded"))
        assertEquals("content://doc/1", success.evidence["pickerReturnedUri"])
        assertEquals("files", skill.capabilityId)
    }

    @Test
    fun `a cancelled picker reads nothing`() = runTest {
        val skill = DeviceCapabilitySkills.pickPhoto { PickResult.Cancelled }
        assertEquals("cancelled", assertIs<SkillResult.Failure>(skill.handler.execute(SkillInput(), context)).reason)
    }

    @Test
    fun `camera capture reports the preview size and that nothing was stored`() = runTest {
        val skill = DeviceCapabilitySkills.capturePhoto { CaptureResult.Captured(640, 480) }
        val success = assertIs<SkillResult.Success>(skill.handler.execute(SkillInput(), context))
        assertTrue(success.summary.contains("640×480") && success.summary.contains("not saved"))
    }

    @Test
    fun `location reports coarse coordinates and provider evidence`() = runTest {
        val skill = DeviceCapabilitySkills.currentLocation(
            { LocationResult.Located(26.2987, 87.2677, 2000f, now.toEpochMilli(), "network") }, clock, zone,
        )
        val success = assertIs<SkillResult.Success>(skill.handler.execute(SkillInput(), context))
        assertTrue(success.summary.startsWith("Your approximate location is 26.299, 87.268 (within about 2.0 km)"))
        assertEquals("network", success.evidence["provider"])
    }

    @Test
    fun `location services off is reported, not faked`() = runTest {
        val skill = DeviceCapabilitySkills.currentLocation({ LocationResult.Unavailable("Location is turned off.", userActionRequired = true) }, clock, zone)
        assertEquals("location_services_off", assertIs<SkillResult.Failure>(skill.handler.execute(SkillInput(), context)).reason)
    }

    @Test
    fun `opening bluetooth settings is USER_ACTION_REQUIRED, never COMPLETED`() = runTest {
        val skill = DeviceCapabilitySkills.openBluetoothSettings { true }
        val success = assertIs<SkillResult.Success>(skill.handler.execute(SkillInput(), context))
        assertTrue(success.userActionRequired)
        val result = ToolResults.from(skill.id, skill, ToolExecutionOutcome.Success(success, 0))
        assertEquals(ToolResultStatus.USER_ACTION_REQUIRED, result.status)
        assertEquals("bluetooth", result.capabilityId)
    }

    @Test
    fun `alarm hands the parsed time to the Clock app and says it cannot confirm saving`() = runTest {
        var handed: Pair<Int, Int>? = null
        val skill = DeviceCapabilitySkills.setAlarm({ h, m, _ -> handed = h to m; true }, clock, zone)
        val success = assertIs<SkillResult.Success>(skill.handler.execute(SkillInput(mapOf("utterance" to "set an alarm for 6:30 am")), context))
        assertEquals(6 to 30, handed)
        assertTrue(success.userActionRequired && success.summary.contains("can't confirm"))
    }

    @Test
    fun `alarm without a time asks instead of guessing`() = runTest {
        val skill = DeviceCapabilitySkills.setAlarm({ _, _, _ -> error("must not be called") }, clock, zone)
        assertEquals("missing_time", assertIs<SkillResult.Failure>(skill.handler.execute(SkillInput(mapOf("utterance" to "set an alarm")), context)).reason)
    }

    @Test
    fun `calendar event opens a pre-filled insert for the user to save`() = runTest {
        var title = ""
        val skill = DeviceCapabilitySkills.createCalendarEvent({ t, _, _ -> title = t; true }, clock, zone)
        val success = assertIs<SkillResult.Success>(
            skill.handler.execute(SkillInput(mapOf("utterance" to "add team meeting to my calendar tomorrow at 5 pm")), context),
        )
        assertEquals("team meeting", title)
        assertTrue(success.userActionRequired && success.summary.contains("Tap Save"))
    }
}
