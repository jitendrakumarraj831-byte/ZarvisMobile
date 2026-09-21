package com.zarvismobile.core.tooling

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Fires when a `personal.reminder` alarm scheduled by [AndroidReminderAlarmPort] comes due,
 * and posts the actual user-visible notification — the second half of the MASTER_SPEC.md §32
 * gap this closes. Declared in `app/src/main/AndroidManifest.xml` since manifest-registered
 * components must be declared in the final app manifest regardless of which module defines
 * the class.
 *
 * Deliberately self-contained (no Room/DAO access): everything needed to show the
 * notification travels in the alarm's own Intent extras, so this receiver has no dependency
 * on the rest of the object graph and needs no Hilt entry point.
 */
class ReminderAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val reminderId = intent.getStringExtra(EXTRA_REMINDER_ID) ?: return
        val title = intent.getStringExtra(EXTRA_REMINDER_TITLE).orEmpty()

        ensureNotificationChannel(context)

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Reminder")
            .setContentText(title.ifEmpty { "You have a reminder due." })
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()

        try {
            // The permission check in the Tool pipeline (§7) guards the moment a reminder is
            // *created*; the user can still revoke POST_NOTIFICATIONS any time before dueAt,
            // so this is the same defensive re-check pattern as AndroidPhoneCallPort's
            // SecurityException catch, not a redundant one.
            if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
                NotificationManagerCompat.from(context).notify(reminderId.hashCode(), notification)
            }
        } catch (e: SecurityException) {
            // Permission revoked between the areNotificationsEnabled() check and notify().
        }
    }

    private fun ensureNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Reminders", NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    companion object {
        const val EXTRA_REMINDER_ID = "com.zarvismobile.core.tooling.EXTRA_REMINDER_ID"
        const val EXTRA_REMINDER_TITLE = "com.zarvismobile.core.tooling.EXTRA_REMINDER_TITLE"
        private const val CHANNEL_ID = "zarvis_reminders"
    }
}
