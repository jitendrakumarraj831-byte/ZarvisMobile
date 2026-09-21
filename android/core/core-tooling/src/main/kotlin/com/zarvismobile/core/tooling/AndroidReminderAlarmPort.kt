package com.zarvismobile.core.tooling

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.zarvismobile.domain.entity.Reminder
import com.zarvismobile.domain.skill.ReminderAlarmPort

/**
 * Real, on-device implementation of [ReminderAlarmPort] for the `personal.reminder` skill —
 * closes the MASTER_SPEC.md §32 gap ("does not yet schedule an OS-level AlarmManager trigger
 * or post a notification at the due time"). [ReminderAlarmReceiver] does the actual posting
 * when the alarm fires.
 *
 * Uses [AlarmManager.setAndAllowWhileIdle] rather than an exact alarm: it still fires during
 * Doze (unlike a plain `set()`), needs no `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM` permission
 * on any API level, and a reminder is not a time-critical alarm-clock use case where the few
 * minutes of possible OS-imposed slop would matter — the honest trade-off documented here
 * rather than left as a silent surprise.
 */
class AndroidReminderAlarmPort(private val context: Context) : ReminderAlarmPort {

    private val alarmManager: AlarmManager
        get() = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    override fun schedule(reminder: Reminder) {
        val pendingIntent = pendingIntentFor(reminder.id, reminder.title)
        alarmManager.setAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP,
            reminder.dueAt.toEpochMilli(),
            pendingIntent,
        )
    }

    override fun cancel(reminderId: String) {
        alarmManager.cancel(pendingIntentFor(reminderId, title = ""))
    }

    private fun pendingIntentFor(reminderId: String, title: String): PendingIntent {
        val intent = Intent(context, ReminderAlarmReceiver::class.java)
            .putExtra(ReminderAlarmReceiver.EXTRA_REMINDER_ID, reminderId)
            .putExtra(ReminderAlarmReceiver.EXTRA_REMINDER_TITLE, title)
        return PendingIntent.getBroadcast(
            context,
            reminderId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
