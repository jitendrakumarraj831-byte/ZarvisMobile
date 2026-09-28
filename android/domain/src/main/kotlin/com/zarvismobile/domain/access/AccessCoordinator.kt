package com.zarvismobile.domain.access

import com.zarvismobile.domain.capability.CapabilityDefinition
import com.zarvismobile.domain.entity.PermissionType

/** The verified result of trying to obtain a capability's access. */
sealed interface AccessResult {
    /** Android now reports every required permission granted. */
    data object Granted : AccessResult

    /** The user chose Not Now on ZARVIS's explanation; no system dialog was shown. */
    data class Declined(val capability: CapabilityDefinition) : AccessResult

    /** The system dialog was shown (or Settings opened) but Android still reports it denied. */
    data class Denied(val capability: CapabilityDefinition, val missing: List<PermissionType>, val permanently: Boolean) : AccessResult

    /**
     * Not possible: this build has no implementation for the capability on Android, or this
     * device cannot provide it ([reason] says which, in user-facing words).
     */
    data class Unsupported(val capability: CapabilityDefinition, val reason: String? = null) : AccessResult
}

/**
 * Blueprint §10 permission flow:
 * Intent → Capability → Permission Intelligence → explain purpose/privacy →
 * Allow / Not Now / Learn More → Android system flow → **verify actual state** → ToolPipeline.
 *
 * Nothing here trusts a stored flag: the decision before asking and the verdict after asking
 * both come from [DeviceAccessPort], i.e. Android itself. Special access (notification access,
 * accessibility, usage access, assistant role) has no runtime dialog, so "Allow" opens its
 * exact Android Settings page and the state is re-read when the user comes back.
 */
class AccessCoordinator(
    private val device: DeviceAccessPort,
    private val rationale: RationalePort,
    private val requester: SystemPermissionRequester,
    private val settings: AppSettingsPort,
) {
    suspend fun ensure(capability: CapabilityDefinition, permissions: List<PermissionType> = capability.permissionTypes): AccessResult {
        if (!capability.implementedOnAndroid) return AccessResult.Unsupported(capability)
        val required = permissions.distinct()
        val before = states(required)
        if (before.values.any { it == AccessState.UNAVAILABLE }) {
            return AccessResult.Unsupported(capability, "This phone's Android version can't provide ${capability.name.lowercase()}.")
        }
        val missing = before.filterValues { !it.satisfied() }.keys.toList()
        if (missing.isEmpty()) return AccessResult.Granted

        val viaSettings = missing.filter { before.getValue(it).needsSettings() }
        val reason = when {
            viaSettings.any { before.getValue(it) == AccessState.SPECIAL_ACCESS_OFF } -> SettingsReason.SPECIAL_ACCESS
            viaSettings.any { before.getValue(it) == AccessState.PERMANENTLY_DENIED } -> SettingsReason.PERMANENTLY_DENIED
            viaSettings.isNotEmpty() -> SettingsReason.SYSTEM_SWITCH_OFF
            else -> null
        }
        val choice = rationale.explain(
            RationaleRequest(capability.id.wireId, missing, requiresSettings = viaSettings.isNotEmpty(), settingsReason = reason),
        )
        if (choice == RationaleChoice.NOT_NOW) return AccessResult.Declined(capability)

        val viaDialog = missing - viaSettings.toSet()
        if (viaDialog.isNotEmpty()) requester.request(viaDialog)
        // One Settings visit per distinct page (e.g. notification access), in order.
        viaSettings.map { settingsTargetFor(it, before.getValue(it)) }.distinct().forEach { settings.openAndAwaitReturn(it) }

        // Verify the real state after the system flow — the dialog or page closing proves nothing.
        val after = states(required)
        val stillMissing = after.filterValues { !it.satisfied() }.keys.toList()
        if (stillMissing.isEmpty()) return AccessResult.Granted
        return AccessResult.Denied(
            capability = capability,
            missing = stillMissing,
            permanently = stillMissing.any { after.getValue(it).needsSettings() },
        )
    }

    private suspend fun states(permissions: List<PermissionType>): Map<PermissionType, AccessState> =
        permissions.associateWith { device.state(it) }
}

fun AccessState.satisfied(): Boolean = this == AccessState.GRANTED || this == AccessState.NOT_REQUIRED

fun AccessState.needsSettings(): Boolean =
    this == AccessState.PERMANENTLY_DENIED || this == AccessState.SYSTEM_DISABLED || this == AccessState.SPECIAL_ACCESS_OFF
