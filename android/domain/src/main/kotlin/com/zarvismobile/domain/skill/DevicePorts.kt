package com.zarvismobile.domain.skill

/** Result of a system picker. [uri] is the content URI the system granted for this one pick. */
sealed interface PickResult {
    data class Picked(val displayName: String, val mimeType: String?, val sizeBytes: Long?, val uri: String) : PickResult
    data object Cancelled : PickResult
    data class Unavailable(val reason: String) : PickResult
}

/** Storage Access Framework document picker (no storage permission). */
fun interface DocumentPickerPort {
    suspend fun pickDocument(): PickResult
}

/** Android Photo Picker (no media permission). */
fun interface PhotoPickerPort {
    suspend fun pickPhoto(): PickResult
}

/** What the server's vision model made of the one photo the user chose. */
sealed interface PhotoDescription {
    data class Described(val text: String) : PhotoDescription

    /** [reason] is a short machine-readable cause; [message] is honest text safe to show the user. */
    data class Failed(val reason: String, val message: String) : PhotoDescription
}

/**
 * Sends the ONE photo the user just picked to the ZARVIS server, where an AI model that can see
 * images describes it. Nothing is kept there. The uri is the content URI the system photo picker
 * granted for this single pick.
 */
fun interface PhotoDescriberPort {
    suspend fun describe(uri: String, mimeType: String?): PhotoDescription
}

sealed interface CaptureResult {
    data class Captured(val width: Int, val height: Int) : CaptureResult
    data object Cancelled : CaptureResult
    data class Unavailable(val reason: String) : CaptureResult
}

/** System camera app capture (ACTION_IMAGE_CAPTURE preview); ZARVIS holds no CAMERA permission. */
fun interface CameraCapturePort {
    suspend fun capturePreview(): CaptureResult
}

sealed interface LocationResult {
    data class Located(
        val latitude: Double,
        val longitude: Double,
        val accuracyMeters: Float?,
        val fixTimeEpochMillis: Long,
        val provider: String,
    ) : LocationResult

    data class Unavailable(val reason: String, val userActionRequired: Boolean) : LocationResult
}

/** Coarse location on request only. */
fun interface LocationPort {
    suspend fun currentCoarseLocation(): LocationResult
}

enum class SettingsPanel { BLUETOOTH, WIFI, LOCATION, APP_NOTIFICATIONS, APP_DETAILS }

/** Opens a system settings screen; true if Android accepted the intent. */
fun interface SystemSettingsPort {
    suspend fun open(panel: SettingsPanel): Boolean
}

/** Hands an alarm to the Clock app (AlarmClock.ACTION_SET_ALARM); true if a Clock app accepted it. */
fun interface AlarmClockPort {
    suspend fun handOffAlarm(hour: Int, minute: Int, label: String): Boolean
}

/** Opens a pre-filled event in the calendar app (ACTION_INSERT); true if a calendar app accepted it. */
fun interface CalendarInsertPort {
    suspend fun handOffEvent(title: String, startEpochMillis: Long, endEpochMillis: Long): Boolean
}
