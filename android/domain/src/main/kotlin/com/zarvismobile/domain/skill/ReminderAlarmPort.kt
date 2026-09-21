package com.zarvismobile.domain.skill

import com.zarvismobile.domain.entity.Reminder

/**
 * Platform seam for the OS-level due-time alert `personal.reminder` schedules alongside
 * persistence (see [ReminderSchedulerPort], MASTER_SPEC.md §32). Android implements this
 * over `AlarmManager` + a notification; nothing else needs to fire at `dueAt`, so a no-op
 * implementation is a valid substitute wherever alerting isn't relevant (e.g. tests of the
 * skill's own create/list/complete logic, which only exercise [ReminderSchedulerPort]).
 */
interface ReminderAlarmPort {
    fun schedule(reminder: Reminder)
    fun cancel(reminderId: String)
}
