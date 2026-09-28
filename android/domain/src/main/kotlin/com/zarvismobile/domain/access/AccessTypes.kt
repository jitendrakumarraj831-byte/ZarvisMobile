package com.zarvismobile.domain.access

import com.zarvismobile.domain.entity.PermissionType

/**
 * The actual state of one runtime permission as reported by Android — never a locally stored
 * flag (blueprint §10: "Never trust only a locally stored permission flag").
 */
enum class AccessState {
    /** Android reports the permission granted (or, for notifications below API 33, enabled). */
    GRANTED,

    /** Never asked on this install; the system dialog can be shown. */
    NOT_REQUESTED,

    /** Denied, but Android will still show the system dialog again. */
    DENIED,

    /** Denied with "don't ask again" (or denied twice): only system Settings can grant it now. */
    PERMANENTLY_DENIED,

    /** Controlled by a system-level switch rather than a runtime dialog (e.g. notifications on Android 8–12). */
    SYSTEM_DISABLED,

    /** No runtime permission exists for this on this device/API level. */
    NOT_REQUIRED,
}

/** Reads real permission state from the platform. */
fun interface DeviceAccessPort {
    suspend fun state(permission: PermissionType): AccessState
}

/** What the user chose on the ZARVIS explanation screen shown before any system dialog. */
enum class RationaleChoice { ALLOW, NOT_NOW }

/** Shows the purpose/privacy explanation with Allow / Not Now (Learn More is inside the UI). */
fun interface RationalePort {
    suspend fun explain(request: RationaleRequest): RationaleChoice
}

data class RationaleRequest(
    val capabilityId: String,
    val permissions: List<PermissionType>,
    /** True when only system Settings can grant it — the UI offers "Open settings" instead of "Allow". */
    val requiresSettings: Boolean,
)

/** Launches the Android system permission dialog and returns once it is dismissed. */
fun interface SystemPermissionRequester {
    suspend fun request(permissions: List<PermissionType>)
}

/** Opens this app's page in Android Settings and returns when the user comes back. */
fun interface AppSettingsPort {
    suspend fun openAndAwaitReturn()
}
