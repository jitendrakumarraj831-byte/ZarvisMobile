package com.zarvismobile.core.tooling

import android.content.Context
import android.content.Intent
import com.zarvismobile.domain.skill.AppLaunchResult
import com.zarvismobile.domain.skill.AppLauncherPort
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Real, on-device implementation of [AppLauncherPort] for the `phone.open_app` skill — see
 * SKILLS.md and MASTER_SPEC.md §28 Phase 4. Resolves [appName] against the labels of every
 * app exposing a launcher entry point and starts the best match.
 *
 * Needs no runtime permission: an app's own launcher `Intent` is visible to any app that
 * declares a matching `<queries>` element (`app/AndroidManifest.xml`) — the
 * `QUERY_ALL_PACKAGES` permission this would otherwise require on Android 11+ is deliberately
 * avoided (Play Store policy discourages it, and this skill only ever needs launchable apps,
 * not every installed package).
 */
class AndroidAppLauncherPort(private val context: Context) : AppLauncherPort {

    override suspend fun openApp(appName: String): AppLaunchResult = withContext(Dispatchers.IO) {
        val packageManager = context.packageManager
        val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val candidates = packageManager.queryIntentActivities(launcherIntent, 0)

        val match = candidates.firstOrNull { resolveInfo ->
            resolveInfo.loadLabel(packageManager).toString().contains(appName, ignoreCase = true)
        } ?: return@withContext AppLaunchResult.NotFound

        val label = match.loadLabel(packageManager).toString()
        val packageName = match.activityInfo?.packageName ?: return@withContext AppLaunchResult.NotFound
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            ?: return@withContext AppLaunchResult.NotFound
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(launchIntent)
        AppLaunchResult.Opened(label)
    }
}
