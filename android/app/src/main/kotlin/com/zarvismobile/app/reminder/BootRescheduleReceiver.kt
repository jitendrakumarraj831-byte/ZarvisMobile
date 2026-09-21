package com.zarvismobile.app.reminder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.zarvismobile.core.tooling.AndroidReminderAlarmPort
import com.zarvismobile.data.local.reminder.ReminderDao
import com.zarvismobile.data.local.reminder.toDomain
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * AlarmManager entries do not survive a reboot — without this, every `personal.reminder`
 * alarm [com.zarvismobile.core.tooling.AndroidReminderAlarmPort] armed would silently vanish
 * the next time the device restarts, which would be exactly the "fake success" Product
 * Principle #4 forbids (the reminder would still show as scheduled in the app, but nothing
 * would fire). Re-arms every incomplete reminder from Room on `BOOT_COMPLETED`; a reminder
 * whose `dueAt` already passed while the device was off fires immediately, since
 * `AlarmManager.setAndAllowWhileIdle` triggers right away for a past `triggerAtMillis`.
 *
 * Registered with `@AndroidEntryPoint` (unlike the plain [com.zarvismobile.core.tooling.
 * ReminderAlarmReceiver], which needs no injected dependencies) because rescheduling needs
 * [ReminderDao] from the app's Hilt graph, and lives in `app` rather than `core-tooling`
 * because only `app` applies the Hilt plugin (see `di/AppModule`'s "Hilt-agnostic modules"
 * note).
 */
@AndroidEntryPoint
class BootRescheduleReceiver : BroadcastReceiver() {

    @Inject lateinit var reminderDao: ReminderDao

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val pendingResult = goAsync()
        val alarmPort = AndroidReminderAlarmPort(context.applicationContext)
        CoroutineScope(Dispatchers.IO).launch {
            try {
                reminderDao.getAll()
                    .filterNot { it.completed }
                    .forEach { alarmPort.schedule(it.toDomain()) }
            } finally {
                pendingResult.finish()
            }
        }
    }
}
