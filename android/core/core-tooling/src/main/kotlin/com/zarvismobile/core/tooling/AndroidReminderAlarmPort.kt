package com.zarvismobile.core.tooling

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.zarvismobile.domain.entity.Reminder
import com.zarvismobile.domain.skill.ReminderAlarmPort

/**
 * Real, on-device implementation of [ReminderAlarmPort] for the `personal.reminder` skill.
 * [ReminderAlarmReceiver] posts the notification when the alarm fires.
 *
 * Timing: an inexact alarm may be delivered well after its time — a reminder set at 8 PM for
 * 8 AM could arrive hours late — so ZARVIS uses an exact, Doze-proof alarm wherever Android
 * allows it: always before Android 12, and on 12+ when the exact-alarm permission is granted
 * (by default on Android 12, by the user in Settings > Alarms & reminders on 13+; Android 14
 * denies it by default). Without it, the fallback is `setAndAllowWhileIdle`: still inexact, so
 * it can arrive some time after `dueAt`, but unlike `setWindow` it is not held back until the
 * next Doze maintenance window, which can be hours away while the phone sits idle overnight.
 */
class AndroidReminderAlarmPort(private val context: Context) : ReminderAlarmPort {

    private val alarmManager: AlarmManager
        get() = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    override fun schedule(reminder: Reminder) {
        val pendingIntent = pendingIntentFor(reminder.id, reminder.title)
        val at = reminder.dueAt.toEpochMilli()
        try {
            if (canScheduleExact()) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pendingIntent)
                return
            }
        } catch (e: SecurityException) {
            // Exact-alarm access was revoked between the check and the call.
        }
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pendingIntent)
    }

    fun canScheduleExact(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()

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
