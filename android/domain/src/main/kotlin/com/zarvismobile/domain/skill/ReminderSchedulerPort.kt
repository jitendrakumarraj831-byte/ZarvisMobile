package com.zarvismobile.domain.skill

import com.zarvismobile.domain.entity.Reminder

/**
 * Platform seam for the `personal.reminder` skill. Android implements this over
 * `AlarmManager`/local notifications; tests implement it in-memory.
 */
interface ReminderSchedulerPort {
    suspend fun schedule(reminder: Reminder): Reminder
    suspend fun list(): List<Reminder>
    suspend fun complete(id: String): Boolean
}
