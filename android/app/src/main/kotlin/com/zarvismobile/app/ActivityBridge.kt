package com.zarvismobile.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.zarvismobile.app.access.ZarvisNotificationListener
import com.zarvismobile.core.security.PermissionRequestLog
import com.zarvismobile.core.security.androidPermission
import com.zarvismobile.domain.access.AppSettingsPort
import com.zarvismobile.domain.access.SettingsTarget
import com.zarvismobile.domain.access.SystemPermissionRequester
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.skill.CameraCapturePort
import com.zarvismobile.domain.skill.CaptureResult
import com.zarvismobile.domain.skill.DocumentPickerPort
import com.zarvismobile.domain.skill.PhotoPickerPort
import com.zarvismobile.domain.skill.PickResult
import java.lang.ref.WeakReference
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * The single bridge between suspend-style domain ports and the Activity Result API: Android
 * permission dialogs, Android Settings pages (app details, app notifications, notification
 * access, accessibility, usage access, default apps), the document picker, the photo picker
 * and the system camera. One request at a time.
 *
 * Both MainActivity and the assistant overlay (AssistActivity) register launchers; requests go
 * through whichever is in front. Launchers are re-registered on every Activity creation, so a
 * result that arrives after a configuration change still completes the waiting call; if the
 * activity that launched a request is finished, the waiting call completes with "no result"
 * instead of hanging. After process death the waiting call is gone and the interrupted action
 * is offered again through PendingActionRecovery (never auto-run).
 */
object ActivityBridge : SystemPermissionRequester, AppSettingsPort, DocumentPickerPort, PhotoPickerPort, CameraCapturePort {

    private class Registered(
        val activity: WeakReference<ComponentActivity>,
        val permission: ActivityResultLauncher<Array<String>>,
        val settings: ActivityResultLauncher<Intent>,
        val document: ActivityResultLauncher<Array<String>>,
        val photo: ActivityResultLauncher<PickVisualMediaRequest>,
        val camera: ActivityResultLauncher<Void?>,
    )

    private val registered = mutableListOf<Registered>()
    private var current: Registered? = null
    private var launchedBy: Registered? = null
    private var requestLog: PermissionRequestLog? = null
    private val mutex = Mutex()

    @Volatile
    private var pending: CompletableDeferred<Any?>? = null

    fun init(log: PermissionRequestLog) {
        requestLog = log
    }

    fun currentActivity(): Activity? = current?.activity?.get()

    /** Must be called from Activity.onCreate (before STARTED), as the Activity Result API requires. */
    fun attach(activity: ComponentActivity) {
        val entry = Registered(
            activity = WeakReference(activity),
            permission = activity.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { deliver(it) },
            settings = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { deliver(Unit) },
            document = activity.registerForActivityResult(ActivityResultContracts.OpenDocument()) { deliver(it) },
            photo = activity.registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { deliver(it) },
            camera = activity.registerForActivityResult(ActivityResultContracts.TakePicturePreview()) { deliver(it) },
        )
        registered.removeAll { it.activity.get() == null }
        registered += entry
        current = entry
    }

    /** From onResume: requests go through the activity the user is looking at. */
    fun activate(activity: ComponentActivity) {
        registered.firstOrNull { it.activity.get() === activity }?.let { current = it }
    }

    fun detach(activity: ComponentActivity) {
        val entry = registered.firstOrNull { it.activity.get() === activity } ?: return
        registered.remove(entry)
        if (current === entry) current = registered.lastOrNull()
        // A finished activity can never deliver its result: release the waiting call.
        if (activity.isFinishing && launchedBy === entry) deliver(null)
    }

    private fun deliver(value: Any?) {
        pending?.complete(value)
        pending = null
        launchedBy = null
    }

    /** Launches and waits for the result; failure when no app can handle the request. */
    private suspend fun awaitResult(entry: Registered, launch: () -> Unit): Result<Any?> = mutex.withLock {
        val deferred = CompletableDeferred<Any?>()
        pending = deferred
        launchedBy = entry
        try {
            withContext(Dispatchers.Main) { launch() }
        } catch (e: ActivityNotFoundException) {
            pending = null
            launchedBy = null
            return@withLock Result.failure(e)
        } catch (e: IllegalStateException) {
            pending = null
            launchedBy = null
            return@withLock Result.failure(e)
        }
        Result.success(deferred.await())
    }

    override suspend fun request(permissions: List<PermissionType>) {
        val names = permissions.mapNotNull { it.androidPermission() }.distinct()
        val entry = current ?: return
        if (names.isEmpty()) return
        awaitResult(entry) { entry.permission.launch(names.toTypedArray()) }
        // Recorded after the dialog so "never asked" vs "denied permanently" stays accurate.
        names.forEach { requestLog?.markRequested(it) }
    }

    override suspend fun openAndAwaitReturn(target: SettingsTarget) {
        val entry = current ?: return
        val activity = entry.activity.get() ?: return
        // Most specific page first, falling back when this Android version lacks it.
        for (intent in settingsIntents(activity, target)) {
            if (awaitResult(entry) { entry.settings.launch(intent) }.isSuccess) return
        }
    }

    internal fun settingsIntents(activity: Activity, target: SettingsTarget): List<Intent> {
        val pkg = activity.packageName
        val pkgUri = Uri.fromParts("package", pkg, null)
        val appDetails = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkgUri)
        return when (target) {
            SettingsTarget.APP_DETAILS -> listOf(appDetails)
            SettingsTarget.APP_NOTIFICATIONS -> listOf(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg),
                appDetails,
            )
            SettingsTarget.NOTIFICATION_LISTENER -> buildList {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    add(
                        Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                            .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, ZarvisNotificationListener.component(activity).flattenToString()),
                    )
                }
                add(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
            SettingsTarget.ACCESSIBILITY -> listOf(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            SettingsTarget.USAGE_ACCESS -> listOf(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, pkgUri), Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
            SettingsTarget.DEFAULT_ASSISTANT -> listOf(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS), Intent(Settings.ACTION_VOICE_INPUT_SETTINGS))
        }
    }

    override suspend fun pickDocument(): PickResult {
        val entry = current ?: return PickResult.Unavailable("Open ZARVIS to pick a document.")
        val uri = awaitResult(entry) { entry.document.launch(arrayOf("*/*")) }.getOrElse {
            return PickResult.Unavailable("This phone has no document picker.")
        } as Uri?
        return uri?.let(::describe) ?: PickResult.Cancelled
    }

    override suspend fun pickPhoto(): PickResult {
        val entry = current ?: return PickResult.Unavailable("Open ZARVIS to pick a photo.")
        val uri = awaitResult(entry) {
            entry.photo.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        }.getOrElse { return PickResult.Unavailable("This phone has no photo picker.") } as Uri?
        return uri?.let(::describe) ?: PickResult.Cancelled
    }

    override suspend fun capturePreview(): CaptureResult {
        val entry = current ?: return CaptureResult.Unavailable("Open ZARVIS to use the camera.")
        val bitmap = awaitResult(entry) { entry.camera.launch(null) }.getOrElse {
            return CaptureResult.Unavailable("This phone has no camera app that ZARVIS can open.")
        } as Bitmap?
        return bitmap?.let { CaptureResult.Captured(it.width, it.height) } ?: CaptureResult.Cancelled
    }

    /** Reads only display metadata for the single URI the system granted. */
    private fun describe(uri: Uri): PickResult {
        val resolver = currentActivity()?.contentResolver ?: return PickResult.Picked("Selected item", null, null, uri.toString())
        var name: String? = null
        var size: Long? = null
        runCatching {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (nameIndex >= 0) name = cursor.getString(nameIndex)
                    if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
                }
            }
        }
        return PickResult.Picked(name ?: "Selected item", runCatching { resolver.getType(uri) }.getOrNull(), size, uri.toString())
    }
}
