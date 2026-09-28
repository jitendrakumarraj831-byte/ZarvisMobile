package com.zarvismobile.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.provider.OpenableColumns
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.zarvismobile.core.security.PermissionRequestLog
import com.zarvismobile.core.security.androidPermission
import com.zarvismobile.domain.access.AppSettingsPort
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
 * permission dialogs, the app's Settings page, the document picker, the photo picker and the
 * system camera. One request at a time. Launchers are re-registered on every Activity
 * creation, so a result that arrives after a configuration change still completes the
 * waiting call; after process death the waiting call is gone and the interrupted action is
 * offered again through PendingActionRecovery instead (never auto-run).
 */
object ActivityBridge : SystemPermissionRequester, AppSettingsPort, DocumentPickerPort, PhotoPickerPort, CameraCapturePort {
    private var activityRef: WeakReference<ComponentActivity>? = null
    private var requestLog: PermissionRequestLog? = null
    private var permissionLauncher: ActivityResultLauncher<Array<String>>? = null
    private var settingsLauncher: ActivityResultLauncher<Intent>? = null
    private var documentLauncher: ActivityResultLauncher<Array<String>>? = null
    private var photoLauncher: ActivityResultLauncher<PickVisualMediaRequest>? = null
    private var cameraLauncher: ActivityResultLauncher<Void?>? = null
    private val mutex = Mutex()

    @Volatile
    private var pending: CompletableDeferred<Any?>? = null

    fun init(log: PermissionRequestLog) {
        requestLog = log
    }

    fun currentActivity(): Activity? = activityRef?.get()

    /** Must be called from Activity.onCreate (before STARTED), as the Activity Result API requires. */
    fun attach(activity: ComponentActivity) {
        activityRef = WeakReference(activity)
        permissionLauncher = activity.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { deliver(it) }
        settingsLauncher = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { deliver(Unit) }
        documentLauncher = activity.registerForActivityResult(ActivityResultContracts.OpenDocument()) { deliver(it) }
        photoLauncher = activity.registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { deliver(it) }
        cameraLauncher = activity.registerForActivityResult(ActivityResultContracts.TakePicturePreview()) { deliver(it) }
    }

    fun detach(activity: ComponentActivity) {
        if (activityRef?.get() === activity) activityRef = null
    }

    private fun deliver(value: Any?) {
        pending?.complete(value)
        pending = null
    }

    /** Launches and waits for the result; null result on launch failure. */
    private suspend fun awaitResult(launch: () -> Unit): Result<Any?> = mutex.withLock {
        val deferred = CompletableDeferred<Any?>()
        pending = deferred
        try {
            withContext(Dispatchers.Main) { launch() }
        } catch (e: ActivityNotFoundException) {
            pending = null
            return@withLock Result.failure(e)
        } catch (e: IllegalStateException) {
            pending = null
            return@withLock Result.failure(e)
        }
        Result.success(deferred.await())
    }

    override suspend fun request(permissions: List<PermissionType>) {
        val names = permissions.mapNotNull { it.androidPermission() }.distinct()
        val launcher = permissionLauncher ?: return
        if (names.isEmpty()) return
        awaitResult { launcher.launch(names.toTypedArray()) }
        // Recorded after the dialog so "never asked" vs "denied permanently" stays accurate.
        names.forEach { requestLog?.markRequested(it) }
    }

    override suspend fun openAndAwaitReturn() {
        val activity = currentActivity() ?: return
        val launcher = settingsLauncher ?: return
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", activity.packageName, null))
        awaitResult { launcher.launch(intent) }
    }

    override suspend fun pickDocument(): PickResult {
        val launcher = documentLauncher ?: return PickResult.Unavailable("Open ZARVIS to pick a document.")
        val uri = awaitResult { launcher.launch(arrayOf("*/*")) }.getOrElse {
            return PickResult.Unavailable("This phone has no document picker.")
        } as Uri?
        return uri?.let(::describe) ?: PickResult.Cancelled
    }

    override suspend fun pickPhoto(): PickResult {
        val launcher = photoLauncher ?: return PickResult.Unavailable("Open ZARVIS to pick a photo.")
        val uri = awaitResult {
            launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        }.getOrElse { return PickResult.Unavailable("This phone has no photo picker.") } as Uri?
        return uri?.let(::describe) ?: PickResult.Cancelled
    }

    override suspend fun capturePreview(): CaptureResult {
        val launcher = cameraLauncher ?: return CaptureResult.Unavailable("Open ZARVIS to use the camera.")
        val bitmap = awaitResult { launcher.launch(null) }.getOrElse {
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
