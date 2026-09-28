package com.zarvismobile.core.tooling

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.CancellationSignal
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.Settings
import androidx.core.location.LocationManagerCompat
import com.zarvismobile.domain.skill.AlarmClockPort
import com.zarvismobile.domain.skill.CalendarInsertPort
import com.zarvismobile.domain.skill.LocationPort
import com.zarvismobile.domain.skill.LocationResult
import com.zarvismobile.domain.skill.SettingsPanel
import com.zarvismobile.domain.skill.SystemSettingsPort
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** Starts [intent] from the application context; false when no app can handle it. */
private fun Context.startOrFalse(intent: Intent): Boolean = try {
    startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    true
} catch (e: ActivityNotFoundException) {
    false
} catch (e: SecurityException) {
    false
}

class AndroidSystemSettingsPort(private val context: Context) : SystemSettingsPort {
    override suspend fun open(panel: SettingsPanel): Boolean = withContext(Dispatchers.Main) {
        val intent = when (panel) {
            SettingsPanel.BLUETOOTH -> Intent(Settings.ACTION_BLUETOOTH_SETTINGS)
            SettingsPanel.WIFI -> Intent(Settings.ACTION_WIFI_SETTINGS)
            SettingsPanel.LOCATION -> Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            SettingsPanel.APP_NOTIFICATIONS -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            SettingsPanel.APP_DETAILS -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
        }
        context.startOrFalse(intent)
    }
}

/** Hands the alarm to the Clock app, which shows it to the user (EXTRA_SKIP_UI = false). */
class AndroidAlarmClockPort(private val context: Context) : AlarmClockPort {
    override suspend fun handOffAlarm(hour: Int, minute: Int, label: String): Boolean = withContext(Dispatchers.Main) {
        context.startOrFalse(
            Intent(AlarmClock.ACTION_SET_ALARM)
                .putExtra(AlarmClock.EXTRA_HOUR, hour)
                .putExtra(AlarmClock.EXTRA_MINUTES, minute)
                .putExtra(AlarmClock.EXTRA_MESSAGE, label)
                .putExtra(AlarmClock.EXTRA_SKIP_UI, false),
        )
    }
}

/** Opens a pre-filled event; the calendar app saves it only if the user taps Save. */
class AndroidCalendarInsertPort(private val context: Context) : CalendarInsertPort {
    override suspend fun handOffEvent(title: String, startEpochMillis: Long, endEpochMillis: Long): Boolean = withContext(Dispatchers.Main) {
        context.startOrFalse(
            Intent(Intent.ACTION_INSERT)
                .setData(CalendarContract.Events.CONTENT_URI)
                .putExtra(CalendarContract.Events.TITLE, title)
                .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, startEpochMillis)
                .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endEpochMillis),
        )
    }
}

/**
 * Coarse location on request. The ToolPipeline has already verified ACCESS_COARSE_LOCATION;
 * the SecurityException catch covers a revocation racing this call. A fresh fix is requested
 * (API 30+); older devices fall back to the most recent network/passive fix, whose age is
 * reported to the user rather than hidden.
 */
class AndroidLocationPort(private val context: Context) : LocationPort {
    private val manager: LocationManager
        get() = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    @SuppressLint("MissingPermission")
    override suspend fun currentCoarseLocation(): LocationResult = try {
        if (!LocationManagerCompat.isLocationEnabled(manager)) {
            LocationResult.Unavailable("Location is turned off on this phone. Turn it on in quick settings, then ask again.", userActionRequired = true)
        } else {
            val provider = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER, LocationManager.PASSIVE_PROVIDER)
                .firstOrNull { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }
                ?: LocationManager.PASSIVE_PROVIDER
            val location = freshFix(provider) ?: lastKnown()
            if (location == null) {
                LocationResult.Unavailable("I couldn't get a location fix right now. Try again in a moment.", userActionRequired = false)
            } else {
                LocationResult.Located(location.latitude, location.longitude, if (location.hasAccuracy()) location.accuracy else null, location.time, location.provider ?: provider)
            }
        }
    } catch (e: SecurityException) {
        LocationResult.Unavailable("Location permission is no longer granted.", userActionRequired = true)
    }

    @SuppressLint("MissingPermission")
    private suspend fun freshFix(provider: String): Location? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
        return withTimeoutOrNull(15_000) {
            suspendCancellableCoroutine { continuation ->
                val signal = CancellationSignal()
                val executor = Executors.newSingleThreadExecutor()
                manager.getCurrentLocation(provider, signal, executor) { location ->
                    executor.shutdown()
                    if (continuation.isActive) continuation.resume(location)
                }
                continuation.invokeOnCancellation {
                    signal.cancel()
                    executor.shutdown()
                }
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun lastKnown(): Location? =
        listOf(LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER, LocationManager.GPS_PROVIDER)
            .mapNotNull { runCatching { manager.getLastKnownLocation(it) }.getOrNull() }
            .maxByOrNull { it.time }
}
