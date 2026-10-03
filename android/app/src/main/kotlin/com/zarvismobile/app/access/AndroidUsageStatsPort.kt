package com.zarvismobile.app.access

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import com.zarvismobile.domain.skill.AppUsage
import com.zarvismobile.domain.skill.UsageReport
import com.zarvismobile.domain.skill.UsageStatsPort
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Today's foreground time per app (capability usage_stats), computed from UsageStatsManager's
 * event stream since local midnight: each resume→pause pair counts, an app already in front at
 * midnight counts from midnight, and an app still in front counts until now. Read only when the
 * user asks; nothing is stored.
 */
class AndroidUsageStatsPort(private val context: Context) : UsageStatsPort {

    @Suppress("DEPRECATION")
    override suspend fun todaySoFar(): UsageReport = withContext(Dispatchers.IO) {
        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return@withContext UsageReport.Unavailable("This phone doesn't provide app usage data.")
        val now = System.currentTimeMillis()
        val start = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
        val events = try {
            manager.queryEvents(start, now)
        } catch (e: SecurityException) {
            return@withContext UsageReport.Unavailable("Usage access is no longer allowed for ZARVIS.")
        }
        val totals = HashMap<String, Long>()
        val openSince = HashMap<String, Long>()
        val seen = HashSet<String>()
        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val pkg = event.packageName ?: continue
            when (event.eventType) {
                UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                    seen += pkg
                    openSince.putIfAbsent(pkg, event.timeStamp)
                }
                UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                    // A pause with no resume today means it was already in front at midnight.
                    val from = openSince.remove(pkg) ?: if (pkg !in seen) start else null
                    seen += pkg
                    if (from != null) totals[pkg] = (totals[pkg] ?: 0L) + (event.timeStamp - from).coerceAtLeast(0L)
                }
            }
        }
        openSince.forEach { (pkg, from) -> totals[pkg] = (totals[pkg] ?: 0L) + (now - from).coerceAtLeast(0L) }
        val apps = totals.filterValues { it > 0 }.map { (pkg, millis) -> AppUsage(pkg, label(pkg), millis) }
        Log.i("ZarvisUsage", "ZARVIS_EVIDENCE usage_stats apps=${apps.size} totalMs=${apps.sumOf { it.foregroundMillis }}")
        UsageReport.Available(sinceEpochMillis = start, apps = apps)
    }

    private fun label(pkg: String): String {
        val pm = context.packageManager
        return try {
            pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
        } catch (e: PackageManager.NameNotFoundException) {
            pkg
        }
    }
}
