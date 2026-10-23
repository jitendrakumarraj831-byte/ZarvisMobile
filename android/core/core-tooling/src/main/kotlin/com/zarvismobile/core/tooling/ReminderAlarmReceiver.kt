package com.zarvismobile.core.tooling

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
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
 * on the rest of the object graph and needs no Hilt entry point. That a reminder has fired is
 * recorded in a small preferences set ([firedIds]); the app's BootRescheduleReceiver marks
 * those reminders completed in Room and never re-arms them, so a reboot does not fire every
 * past reminder again.
 */
class ReminderAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val reminderId = intent.getStringExtra(EXTRA_REMINDER_ID) ?: return
        val title = intent.getStringExtra(EXTRA_REMINDER_TITLE).orEmpty()

        // Recorded first, whether or not the notification can be shown: this alarm has done its job.
        markFired(context, reminderId)
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
        // minSdk is 26 (O): notification channels always exist.
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
        private const val FIRED_PREFS = "zarvis_reminders_fired"
        private const val FIRED_IDS = "fired_ids"

        /** Ids of the reminders whose alarm has fired since [forgetFired] last took them. */
        fun firedIds(context: Context): Set<String> =
            context.getSharedPreferences(FIRED_PREFS, Context.MODE_PRIVATE).getStringSet(FIRED_IDS, null).orEmpty().toSet()

        /** Drops [ids] from [firedIds] once they are recorded as completed elsewhere. */
        fun forgetFired(context: Context, ids: Set<String>) {
            if (ids.isEmpty()) return
            val prefs = context.getSharedPreferences(FIRED_PREFS, Context.MODE_PRIVATE)
            prefs.edit().putStringSet(FIRED_IDS, prefs.getStringSet(FIRED_IDS, null).orEmpty() - ids).apply()
        }

        private fun markFired(context: Context, id: String) {
            val prefs = context.getSharedPreferences(FIRED_PREFS, Context.MODE_PRIVATE)
            // A new set: the one getStringSet returns must not be modified.
            prefs.edit().putStringSet(FIRED_IDS, prefs.getStringSet(FIRED_IDS, null).orEmpty() + id).apply()
        }
    }
}
