package com.zarvismobile.data.local.reminder

import com.zarvismobile.domain.entity.Reminder
import com.zarvismobile.domain.skill.ReminderAlarmPort
import com.zarvismobile.domain.skill.ReminderSchedulerPort
import java.time.Instant

/**
 * Room-backed implementation of [ReminderSchedulerPort] for the `personal.reminder` skill
 * (SKILLS.md). Persists reminders locally so they survive process death and are listable,
 * and — via [alarmPort] — arms the real OS-level due-time alert (MASTER_SPEC.md §32's
 * "does not yet schedule an AlarmManager trigger" gap, now closed; [alarmPort] is
 * [com.zarvismobile.core.tooling.AndroidReminderAlarmPort] on a real device).
 */
class RoomReminderScheduler(
    private val dao: ReminderDao,
    private val alarmPort: ReminderAlarmPort,
) : ReminderSchedulerPort {
    override suspend fun schedule(reminder: Reminder): Reminder {
        dao.upsert(reminder.toEntity())
        alarmPort.schedule(reminder)
        return reminder
    }

    override suspend fun list(): List<Reminder> = dao.getAll().map { it.toDomain() }

    override suspend fun complete(id: String): Boolean {
        val completed = dao.markCompleted(id) > 0
        if (completed) alarmPort.cancel(id)
        return completed
    }
}

private fun Reminder.toEntity() = ReminderEntity(
    id = id,
    title = title,
    dueAtEpochMillis = dueAt.toEpochMilli(),
    completed = completed,
)

// Public, not private: BootRescheduleReceiver (app module) reuses this to re-arm alarms
// AlarmManager drops on reboot (see its doc comment) from the same persisted rows.
fun ReminderEntity.toDomain() = Reminder(
    id = id,
    title = title,
    dueAt = Instant.ofEpochMilli(dueAtEpochMillis),
    completed = completed,
)
