package com.zarvismobile.domain.skill

import com.zarvismobile.domain.FixedClockPort
import com.zarvismobile.domain.InMemoryReminderScheduler
import com.zarvismobile.domain.entity.SkillExecutionContext
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.entity.SkillResult
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ReminderSkillFactoryTest {

    // 10:00 in India (UTC+5:30).
    private val now = Instant.parse("2026-08-26T04:30:00Z")
    private val zone = ZoneId.of("Asia/Kolkata")
    private val context = SkillExecutionContext(accountId = "acc-1")
    private fun skill(scheduler: InMemoryReminderScheduler = InMemoryReminderScheduler()) =
        ReminderSkillFactory.create(scheduler, FixedClockPort(now)) { zone }

    @Test
    fun `creating a reminder without a title fails with a user-facing message`() = runTest {
        val failure = assertIs<SkillResult.Failure>(skill().handler.execute(SkillInput(mapOf("action" to "create")), context))
        assertEquals("missing_title", failure.reason)
    }

    @Test
    fun `a reminder with no stated time is not created - the user is asked for the time`() = runTest {
        val scheduler = InMemoryReminderScheduler()
        val failure = assertIs<SkillResult.Failure>(
            skill(scheduler).handler.execute(SkillInput(mapOf("action" to "create", "title" to "remind me to call mom")), context),
        )
        assertEquals("missing_time", failure.reason)
        assertTrue(scheduler.list().isEmpty())
    }

    @Test
    fun `tomorrow at 8am schedules exactly that time and says so`() = runTest {
        val scheduler = InMemoryReminderScheduler()
        val success = assertIs<SkillResult.Success>(
            skill(scheduler).handler.execute(SkillInput(mapOf("action" to "create", "title" to "remind me to call mom tomorrow at 8am")), context),
        )
        val reminder = scheduler.list().single()
        assertEquals(Instant.parse("2026-08-27T02:30:00Z"), reminder.dueAt)
        assertEquals("call mom", reminder.title)
        assertEquals("Reminder set for Thu 27 Aug, 8:00 AM: \"call mom\".", success.summary)
    }

    @Test
    fun `a time that already passed today is rejected rather than silently moved`() = runTest {
        val failure = assertIs<SkillResult.Failure>(
            skill().handler.execute(SkillInput(mapOf("action" to "create", "title" to "remind me today at 7am to walk")), context),
        )
        assertEquals("time_in_past", failure.reason)
    }

    @Test
    fun `an explicit ISO dueAt is honored`() = runTest {
        val scheduler = InMemoryReminderScheduler()
        skill(scheduler).handler.execute(SkillInput(mapOf("action" to "create", "title" to "Pay rent", "dueAt" to "2026-09-01T03:30:00Z")), context)
        assertEquals(Instant.parse("2026-09-01T03:30:00Z"), scheduler.list().single().dueAt)
    }

    @Test
    fun `listing shows upcoming reminders with their times`() = runTest {
        val scheduler = InMemoryReminderScheduler()
        val s = skill(scheduler)
        s.handler.execute(SkillInput(mapOf("action" to "create", "title" to "remind me to buy milk in 30 minutes")), context)
        val success = assertIs<SkillResult.Success>(s.handler.execute(SkillInput(mapOf("action" to "list")), context))
        assertEquals("You have 1 upcoming reminder(s): Wed 26 Aug, 10:30 AM — buy milk", success.summary)
    }

    @Test
    fun `completing an unknown reminder id fails cleanly`() = runTest {
        val failure = assertIs<SkillResult.Failure>(skill().handler.execute(SkillInput(mapOf("action" to "complete", "id" to "nope")), context))
        assertEquals("not_found", failure.reason)
    }

    @Test
    fun `an unrecognized action fails without throwing`() = runTest {
        val failure = assertIs<SkillResult.Failure>(skill().handler.execute(SkillInput(mapOf("action" to "delete_everything")), context))
        assertEquals("invalid_action", failure.reason)
    }
}
