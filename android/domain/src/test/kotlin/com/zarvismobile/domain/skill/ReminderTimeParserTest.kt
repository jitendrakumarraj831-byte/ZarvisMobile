package com.zarvismobile.domain.skill

import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class ReminderTimeParserTest {
    // Wednesday 26 Aug 2026, 10:00 IST
    private val now = ZonedDateTime.of(2026, 8, 26, 10, 0, 0, 0, ZoneId.of("Asia/Kolkata"))

    private fun parsed(text: String) = assertIs<ReminderTimeParser.Result.Parsed>(ReminderTimeParser.parse(text, now), text)

    @Test
    fun `relative minutes and hours`() {
        assertEquals(now.plusMinutes(10), parsed("remind me in 10 minutes to stretch").dueAt)
        assertEquals(now.plusHours(1), parsed("remind me in an hour to call").dueAt)
        assertEquals(now.plusHours(2), parsed("in 2 hours check the oven").dueAt)
        assertEquals(now.plusMinutes(30), parsed("remind me in half an hour").dueAt)
    }

    @Test
    fun `hinglish and hindi relative times`() {
        assertEquals(now.plusMinutes(10), parsed("10 minute mein chai yaad dilana").dueAt)
        assertEquals(now.plusHours(2), parsed("2 ghante baad dawai").dueAt)
        assertEquals(now.plusMinutes(30), parsed("30 मिनट में पानी पीना याद दिलाना").dueAt)
    }

    @Test
    fun `clock times with and without meridiem`() {
        assertEquals(now.withHour(20).withMinute(0), parsed("remind me at 8pm to lock the door").dueAt)
        assertEquals(now.withHour(18).withMinute(30), parsed("at 6:30 pm call dad").dueAt)
        assertEquals(now.withHour(20).withMinute(15), parsed("at 20:15 standup").dueAt)
        // 8 with no meridiem, already past today (10:00) → next occurrence tomorrow 8:00.
        assertEquals(now.plusDays(1).withHour(8).withMinute(0), parsed("remind me at 8 to walk").dueAt)
        // 3 without meridiem is read as afternoon.
        assertEquals(now.withHour(15).withMinute(0), parsed("remind me at 3 to pick up kids").dueAt)
    }

    @Test
    fun `days and dayparts`() {
        assertEquals(now.plusDays(1).withHour(8).withMinute(0), parsed("remind me to call mom tomorrow at 8am").dueAt)
        assertEquals(now.plusDays(1).withHour(8).withMinute(0), parsed("kal subah 8 baje dawai lena yaad dilana").dueAt)
        assertEquals(now.withHour(21).withMinute(0), parsed("aaj raat 9 baje movie").dueAt)
        assertEquals(now.withHour(18).withMinute(0), parsed("शाम 6 बजे दूध लाना").dueAt)
        assertEquals(now.plusDays(5).withHour(9).withMinute(0), parsed("remind me on monday at 9 am about rent").dueAt)
        assertEquals(now.withHour(21).withMinute(0), parsed("remind me tonight to call").dueAt)
    }

    @Test
    fun `titles are stripped of triggers and time words`() {
        assertEquals("call mom", parsed("remind me to call mom tomorrow at 8am").title)
        assertEquals("dawai lena", parsed("kal subah 8 baje dawai lena yaad dilana").title)
        assertEquals("lock the door", parsed("remind me at 8pm to lock the door").title)
    }

    @Test
    fun `no time means NoTime, never a guess`() {
        assertIs<ReminderTimeParser.Result.NoTime>(ReminderTimeParser.parse("remind me to call mom", now))
        assertIs<ReminderTimeParser.Result.NoTime>(ReminderTimeParser.parse("remind me tomorrow to call mom", now))
    }

    @Test
    fun `an explicit day with a past time is InPast`() {
        assertIs<ReminderTimeParser.Result.InPast>(ReminderTimeParser.parse("today at 7am walk", now))
    }
}
