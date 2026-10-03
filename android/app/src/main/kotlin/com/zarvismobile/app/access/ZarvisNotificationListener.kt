package com.zarvismobile.app.access

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import com.zarvismobile.domain.notification.NotificationSnapshot
import com.zarvismobile.domain.skill.ActiveNotifications
import com.zarvismobile.domain.skill.NotificationReaderPort
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull

/**
 * ZARVIS's notification listener (capability notification_read / notification_speak).
 * Android binds it only while the user has granted Notification access, and unbinds it the
 * moment access is turned off. It keeps no history: reading uses the notifications currently
 * in the status bar, and each new one is only handed to [NotificationSpeaker], which decides
 * (by the user's privacy rules) whether anything is said.
 */
@AndroidEntryPoint
class ZarvisNotificationListener : NotificationListenerService() {

    @Inject lateinit var speaker: NotificationSpeaker

    override fun onListenerConnected() {
        connected = this
        Log.i(TAG, "ZARVIS_EVIDENCE notification_listener connected")
    }

    override fun onListenerDisconnected() {
        if (connected === this) connected = null
        Log.i(TAG, "ZARVIS_EVIDENCE notification_listener disconnected")
    }

    override fun onDestroy() {
        if (connected === this) connected = null
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val snapshot = NotificationSnapshots.from(sbn, this) ?: return
        speaker.onNotificationPosted(snapshot)
    }

    companion object {
        private const val TAG = "ZarvisNotifications"

        @Volatile
        internal var connected: ZarvisNotificationListener? = null
            private set

        fun component(context: Context) = ComponentName(context, ZarvisNotificationListener::class.java)
    }
}

/** Converts what Android reported into the domain snapshot; null for notifications ZARVIS ignores. */
object NotificationSnapshots {
    private const val EXTRA_APP_INFO = "android.appInfo"

    fun from(sbn: StatusBarNotification, context: Context): NotificationSnapshot? {
        val n = sbn.notification ?: return null
        if (sbn.packageName == context.packageName) return null // ZARVIS's own (e.g. reminders)
        if (sbn.isOngoing || n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return null
        val extras = n.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim()?.ifEmpty { null }
        val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))
            ?.toString()?.trim()?.ifEmpty { null }
        if (title == null && text == null) return null
        return NotificationSnapshot(
            key = sbn.key,
            packageName = sbn.packageName,
            appLabel = appLabel(sbn, context),
            category = n.category,
            sender = sender(n, title),
            title = title,
            text = text,
            postedAtMillis = sbn.postTime,
        )
    }

    /** Only a name Android put in a conversation notification — never a guess. */
    private fun sender(n: Notification, title: String?): String? {
        val messaging = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n)
        messaging?.messages?.lastOrNull()?.person?.name?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        return when (n.category) {
            Notification.CATEGORY_MESSAGE, Notification.CATEGORY_EMAIL, Notification.CATEGORY_CALL, "missed_call" -> title
            else -> null
        }
    }

    @Suppress("DEPRECATION")
    private fun appLabel(sbn: StatusBarNotification, context: Context): String {
        val pm = context.packageManager
        // Notification.Builder stores the posting app's ApplicationInfo under this (hidden) key.
        val fromExtras = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            sbn.notification.extras.getParcelable(EXTRA_APP_INFO, ApplicationInfo::class.java)
        } else {
            sbn.notification.extras.getParcelable<ApplicationInfo>(EXTRA_APP_INFO)
        }
        val info = fromExtras ?: try {
            pm.getApplicationInfo(sbn.packageName, 0)
        } catch (e: PackageManager.NameNotFoundException) {
            null
        }
        return info?.loadLabel(pm)?.toString()?.takeIf { it.isNotBlank() } ?: sbn.packageName
    }
}

/**
 * Reads the notifications currently in the status bar through the bound listener. If access is
 * on but Android hasn't (re)bound the listener yet — e.g. just after the app process restarted —
 * it asks Android to rebind and waits briefly, then reports NotConnected rather than guessing.
 */
class AndroidNotificationReaderPort(private val context: Context) : NotificationReaderPort {
    override suspend fun active(): ActiveNotifications {
        val listener = ZarvisNotificationListener.connected ?: run {
            NotificationListenerService.requestRebind(ZarvisNotificationListener.component(context))
            withTimeoutOrNull(3_000) {
                while (ZarvisNotificationListener.connected == null) delay(100)
                ZarvisNotificationListener.connected
            }
        } ?: return ActiveNotifications.NotConnected
        val items = try {
            listener.activeNotifications.orEmpty().mapNotNull { NotificationSnapshots.from(it, context) }
        } catch (e: SecurityException) {
            return ActiveNotifications.NotConnected // access revoked between the check and the read
        }
        Log.i("ZarvisNotifications", "ZARVIS_EVIDENCE notification_read active=${items.size}")
        return ActiveNotifications.Available(items)
    }
}
