package com.jarvismobile.data.local.reminder

import com.jarvismobile.domain.entity.Reminder
import com.jarvismobile.domain.skill.ReminderSchedulerPort
import java.time.Instant

/**
 * Room-backed implementation of [ReminderSchedulerPort] for the `personal.reminder` skill
 * (SKILLS.md). Persists reminders locally so they survive process death and are listable.
 *
 * Known simplification (see MASTER_SPEC.md §29/§32): this does not yet schedule an OS-level
 * `AlarmManager` trigger or post a notification at `dueAt` — the reminder is stored and can
 * be listed/completed, but a real due-time alert is planned, not implemented, in this pass.
 */
class RoomReminderScheduler(private val dao: ReminderDao) : ReminderSchedulerPort {
    override suspend fun schedule(reminder: Reminder): Reminder {
        dao.upsert(reminder.toEntity())
        return reminder
    }

    override suspend fun list(): List<Reminder> = dao.getAll().map { it.toDomain() }

    override suspend fun complete(id: String): Boolean = dao.markCompleted(id) > 0
}

private fun Reminder.toEntity() = ReminderEntity(
    id = id,
    title = title,
    dueAtEpochMillis = dueAt.toEpochMilli(),
    completed = completed,
)

private fun ReminderEntity.toDomain() = Reminder(
    id = id,
    title = title,
    dueAt = Instant.ofEpochMilli(dueAtEpochMillis),
    completed = completed,
)
