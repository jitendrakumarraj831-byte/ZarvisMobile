package com.zarvismobile.domain.access

import com.zarvismobile.domain.entity.PermissionType

/** Persists the last *observed* grant state so a later observation can be compared with it. */
interface AccessSnapshotStore {
    suspend fun load(): Map<PermissionType, Boolean>
    suspend fun save(snapshot: Map<PermissionType, Boolean>)
}

/**
 * Detects permissions the user revoked outside ZARVIS (e.g. in Android Settings) since the last
 * time the app looked. The stored snapshot is only used to *notice a change* — authorization
 * decisions always re-read the live state through [DeviceAccessPort].
 */
class RevocationDetector(
    private val device: DeviceAccessPort,
    private val store: AccessSnapshotStore,
) {
    data class Report(
        val revoked: List<PermissionType>,
        val newlyGranted: List<PermissionType>,
        val current: Map<PermissionType, AccessState>,
    )

    suspend fun check(permissions: Collection<PermissionType> = PermissionType.entries): Report {
        val previous = store.load()
        val current = permissions.associateWith { device.state(it) }
        val grantedNow = current.mapValues { it.value.satisfied() }
        val revoked = grantedNow.filter { (permission, granted) -> !granted && previous[permission] == true }.keys.toList()
        val newlyGranted = grantedNow.filter { (permission, granted) -> granted && previous[permission] == false }.keys.toList()
        store.save(grantedNow)
        return Report(revoked = revoked, newlyGranted = newlyGranted, current = current)
    }
}
