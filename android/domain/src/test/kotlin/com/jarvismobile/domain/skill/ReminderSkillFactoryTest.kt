package com.jarvismobile.domain.skill

import com.jarvismobile.domain.FixedClockPort
import com.jarvismobile.domain.InMemoryReminderScheduler
import com.jarvismobile.domain.entity.SkillExecutionContext
import com.jarvismobile.domain.entity.SkillInput
import com.jarvismobile.domain.entity.SkillResult
import java.time.Instant
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class ReminderSkillFactoryTest {

    private val now = Instant.parse("2026-08-26T00:00:00Z")
    private val context = SkillExecutionContext(accountId = "acc-1")

    @Test
    fun `creating a reminder without a title fails with a user-facing message`() = runTest {
        val skill = ReminderSkillFactory.create(InMemoryReminderScheduler(), FixedClockPort(now))
        val result = skill.handler.execute(SkillInput(mapOf("action" to "create")), context)
        val failure = assertIs<SkillResult.Failure>(result)
        assertEquals("missing_title", failure.reason)
    }

    @Test
    fun `creating a reminder without an explicit due time defaults to one hour from now`() = runTest {
        val scheduler = InMemoryReminderScheduler()
        val skill = ReminderSkillFactory.create(scheduler, FixedClockPort(now))
        val result = skill.handler.execute(SkillInput(mapOf("action" to "create", "title" to "Call mom")), context)
        assertIs<SkillResult.Success>(result)
        val reminders = scheduler.list()
        assertEquals(1, reminders.size)
        assertEquals(now.plusSeconds(3600), reminders.single().dueAt)
    }

    @Test
    fun `listing reflects previously created reminders`() = runTest {
        val scheduler = InMemoryReminderScheduler()
        val skill = ReminderSkillFactory.create(scheduler, FixedClockPort(now))
        skill.handler.execute(SkillInput(mapOf("action" to "create", "title" to "Buy milk")), context)
        val result = skill.handler.execute(SkillInput(mapOf("action" to "list")), context)
        val success = assertIs<SkillResult.Success>(result)
        assertEquals("You have 1 reminder(s).", success.summary)
    }

    @Test
    fun `completing an unknown reminder id fails cleanly`() = runTest {
        val skill = ReminderSkillFactory.create(InMemoryReminderScheduler(), FixedClockPort(now))
        val result = skill.handler.execute(SkillInput(mapOf("action" to "complete", "id" to "nope")), context)
        val failure = assertIs<SkillResult.Failure>(result)
        assertEquals("not_found", failure.reason)
    }

    @Test
    fun `an unrecognized action fails without throwing`() = runTest {
        val skill = ReminderSkillFactory.create(InMemoryReminderScheduler(), FixedClockPort(now))
        val result = skill.handler.execute(SkillInput(mapOf("action" to "delete_everything")), context)
        val failure = assertIs<SkillResult.Failure>(result)
        assertEquals("invalid_action", failure.reason)
    }
}
