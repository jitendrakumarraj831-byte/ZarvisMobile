package com.zarvismobile.core.tooling

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.AlarmClock
import android.provider.MediaStore
import android.provider.Settings
import com.zarvismobile.domain.skill.AppAliases
import com.zarvismobile.domain.skill.AppLaunchResult
import com.zarvismobile.domain.skill.AppLauncherPort
import com.zarvismobile.domain.skill.AppRole
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Real, on-device implementation of [AppLauncherPort] for the `phone.open_app` skill — see
 * SKILLS.md and MASTER_SPEC.md §28 Phase 4.
 *
 * A kind of app ("gallery", "camera", "settings", "contacts", "गैलरी" — [AppAliases]) is opened through Android's own intent for that
 * role, so it finds the phone's gallery whether it is called "Photos" or "Gallery". Any other name is matched against the labels of
 * every app with a launcher entry point (same name first, then a label starting with it, then one containing it; [AppAliases.bestLabelMatch]).
 *
 * Needs no runtime permission: an app's own launcher `Intent` is visible to any app that
 * declares a matching `<queries>` element (`app/AndroidManifest.xml`) — the
 * `QUERY_ALL_PACKAGES` permission this would otherwise require on Android 11+ is deliberately
 * avoided (Play Store policy discourages it, and this skill only ever needs launchable apps,
 * not every installed package). The role intents are declared there too.
 */
class AndroidAppLauncherPort(private val context: Context) : AppLauncherPort {

    override suspend fun openApp(appName: String): AppLaunchResult = withContext(Dispatchers.IO) {
        val resolution = AppAliases.resolve(appName)
        resolution.role?.let { role -> roleIntent(role)?.let { intent -> start(intent, role.displayName)?.let { return@withContext it } } }

        val packageManager = context.packageManager
        val launchables = packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
            .filter { it.activityInfo?.packageName != context.packageName }
        val labels = launchables.map { it.loadLabel(packageManager).toString() }
        for (wanted in resolution.labels) {
            val index = AppAliases.bestLabelMatch(wanted, labels) ?: continue
            val packageName = launchables[index].activityInfo?.packageName ?: continue
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: continue
            start(launchIntent, labels[index])?.let { return@withContext it }
        }
        AppLaunchResult.NotFound
    }

    /**
     * Starts [intent] if an app on this phone handles it, and names the app that will show it. When several apps could (and none is the
     * default), Android shows its own chooser and the role's name is used instead of the chooser's.
     */
    private fun start(intent: Intent, fallbackName: String): AppLaunchResult? {
        val packageManager = context.packageManager
        val target = packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) ?: return null
        val name = if (target.activityInfo?.packageName == "android") fallbackName else target.loadLabel(packageManager).toString()
        return try {
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            AppLaunchResult.Opened(name)
        } catch (e: ActivityNotFoundException) {
            null
        } catch (e: SecurityException) {
            null
        }
    }

    /** Android's intent for a kind of app, or null when it has none (Files, Play Store: found by label). */
    private fun roleIntent(role: AppRole): Intent? = when (role) {
        AppRole.GALLERY -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_GALLERY)
        AppRole.CAMERA -> Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)
        AppRole.SETTINGS -> Intent(Settings.ACTION_SETTINGS)
        AppRole.CONTACTS -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_CONTACTS)
        // The dialer with nothing typed in: opening it places no call and needs no permission.
        AppRole.DIALER -> Intent(Intent.ACTION_DIAL)
        AppRole.MESSAGES -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_MESSAGING)
        AppRole.BROWSER -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_BROWSER)
        AppRole.CALCULATOR -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_CALCULATOR)
        AppRole.CALENDAR -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_CALENDAR)
        AppRole.CLOCK -> Intent(AlarmClock.ACTION_SHOW_ALARMS)
        AppRole.MAPS -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_MAPS)
        AppRole.MUSIC -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_MUSIC)
        AppRole.EMAIL -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_EMAIL)
        AppRole.FILES, AppRole.PLAY_STORE -> null
    }
}
