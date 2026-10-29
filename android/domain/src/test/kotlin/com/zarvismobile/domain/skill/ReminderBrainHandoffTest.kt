package com.zarvismobile.domain.skill

import com.zarvismobile.domain.FixedClockPort
import com.zarvismobile.domain.InMemoryReminderScheduler
import com.zarvismobile.domain.entity.SkillExecutionContext
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.entity.SkillResult
import com.zarvismobile.domain.orchestrator.OnDeviceInputBuilder
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * A reminder the Brain hands to the phone (personal.reminder as a device action). The server passes on only the planner's `action` and
 * `title` (backend sanitizeDeviceInput), and a real model writes the title as a short label ("Call mom") or rewrites "in 2 hours" as a
 * clock time it cannot know. The phone has the user's own words: the time they said is the one that is scheduled.
 *
 * Regression: the phone took the time only from the planner's title, so "kal subah 8 baje mummy ko call karne ka reminder set kar do"
 * came back FAILED ("When should I remind you?") and a relative time rewritten as an hour already gone came back FAILED ("has already
 * passed"), while the request itself said when.
 */
class ReminderBrainHandoffTest {

    // 10:00 in India (UTC+5:30), Wednesday 26 August 2026.
    private val now = Instant.parse("2026-08-26T04:30:00Z")
    private val zone = ZoneId.of("Asia/Kolkata")
    private val context = SkillExecutionContext(accountId = "acc-1")
    private val scheduler = InMemoryReminderScheduler()
    private val skill = ReminderSkillFactory.create(scheduler, FixedClockPort(now)) { zone }

    /** The input AndroidOrchestrator.runDeviceAction builds for a handed-over action: the user's words, then the Brain's input over them. */
    private fun handedOver(said: String, brain: Map<String, String>): SkillInput {
        val fromWords = OnDeviceInputBuilder.build(skill, said).values.filterKeys { it !in skill.inputSchema.requiredFields }
        return SkillInput(fromWords + brain.filterValues { it.isNotBlank() })
    }

    private suspend fun run(said: String, brain: Map<String, String>): SkillResult = skill.handler.execute(handedOver(said, brain), context)

    @Test
    fun `the time the user said is scheduled when the Brain's title has none`() = runTest {
        val result = run("kal subah 8 baje mummy ko call karne ka reminder set kar do", mapOf("action" to "create", "title" to "Call mom"))

        val success = assertIs<SkillResult.Success>(result)
        val reminder = scheduler.list().single()
        assertEquals(Instant.parse("2026-08-27T02:30:00Z"), reminder.dueAt) // Thursday 08:00 in India
        assertEquals("Call mom", reminder.title)
        assertEquals("Reminder set for Thu 27 Aug, 8:00 AM: \"Call mom\".", success.summary)
    }

    @Test
    fun `a relative time the user said wins over a clock time the Brain guessed`() = runTest {
        // The planner does not know it is 10:00 on the phone and wrote 9 am, which has passed.
        val result = run("2 ghante baad dawai lene ka reminder set karo", mapOf("action" to "create", "title" to "Take medicine today at 9 am"))

        assertIs<SkillResult.Success>(result)
        val reminder = scheduler.list().single()
        assertEquals(Instant.parse("2026-08-26T06:30:00Z"), reminder.dueAt) // 12:00 in India
        assertEquals("Take medicine", reminder.title)
    }

    @Test
    fun `when the user's words have no time the Brain's title still gives it`() = runTest {
        // The time was said earlier in the chat ("kal 10 baje Rahul se meeting hai"); only the Brain saw it.
        val result = run("iska reminder laga do", mapOf("action" to "create", "title" to "Meeting with Rahul tomorrow at 10 am"))

        assertIs<SkillResult.Success>(result)
        val reminder = scheduler.list().single()
        assertEquals(Instant.parse("2026-08-27T04:30:00Z"), reminder.dueAt)
        assertEquals("Meeting with Rahul", reminder.title)
    }

    @Test
    fun `with no time anywhere nothing is scheduled and the user is asked for one`() = runTest {
        val failure = assertIs<SkillResult.Failure>(run("paani peene ka reminder set karo", mapOf("action" to "create", "title" to "Drink water")))

        assertEquals("missing_time", failure.reason)
        assertTrue(scheduler.list().isEmpty())
    }

    @Test
    fun `a time the user said that has already passed is not moved to another day`() = runTest {
        val failure = assertIs<SkillResult.Failure>(
            run("aaj subah 7 baje walk ka reminder set karo", mapOf("action" to "create", "title" to "Walk tomorrow at 7 am")),
        )

        assertEquals("time_in_past", failure.reason)
        assertTrue(scheduler.list().isEmpty())
    }

    @Test
    fun `a time-only title from the Brain is labelled from the user's words`() = runTest {
        val result = run("1 minute baad paani peene ka reminder set karo", mapOf("action" to "create", "title" to "in 1 minute"))

        assertIs<SkillResult.Success>(result)
        val reminder = scheduler.list().single()
        assertEquals(Instant.parse("2026-08-26T04:31:00Z"), reminder.dueAt)
        assertTrue(reminder.title.contains("paani peene"), reminder.title)
    }
}
