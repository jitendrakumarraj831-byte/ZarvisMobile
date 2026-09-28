package com.zarvismobile.domain.capability

import com.zarvismobile.domain.entity.ActionClass
import com.zarvismobile.domain.entity.CapabilityStatus
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.entity.RiskLevel
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Blueprint §10 capability ids — must match shared/capability-registry.json exactly. */
enum class CapabilityId(val wireId: String) {
    MICROPHONE("microphone"),
    CONTACTS("contacts"),
    PHONE_CALL("phone_call"),
    NOTIFICATION_READ("notification_read"),
    NOTIFICATION_SPEAK("notification_speak"),
    CAMERA("camera"),
    FILES("files"),
    PHOTOS("photos"),
    LOCATION("location"),
    BLUETOOTH("bluetooth"),
    ALARMS("alarms"),
    CALENDAR("calendar"),
    ACCESSIBILITY("accessibility"),
    USAGE_STATS("usage_stats"),
    DEFAULT_ASSISTANT("default_assistant"),
    SCREEN_INTERACTION("screen_interaction"),
    ;

    companion object {
        fun fromWire(id: String): CapabilityId? = entries.firstOrNull { it.wireId == id }
    }
}

enum class ConfirmationPolicy { NONE, PER_ACTION }

data class PlatformState(val status: CapabilityStatus, val note: String)

data class PermissionRationale(val why: String, val data: String, val notAutomatic: String, val revoke: String)

/** One capability as defined by the shared registry (blueprint §10 fields). */
data class CapabilityDefinition(
    val id: CapabilityId,
    val name: String,
    val requiredAccess: String,
    /** Raw Android permission names from the registry. */
    val androidPermissions: List<String>,
    val androidRequirements: String,
    val risk: RiskLevel,
    val actionClass: ActionClass,
    val dataExposure: String,
    val supportedActions: List<String>,
    val unsupportedActions: List<String>,
    val confirmation: ConfirmationPolicy,
    val denialBehavior: String,
    val fallback: String,
    val revocationHandling: String,
    val settingsDestination: String,
    val rationale: PermissionRationale,
    val web: PlatformState,
    val android: PlatformState,
) {
    /** The runtime permission groups ZARVIS requests for this capability. */
    val permissionTypes: List<PermissionType>
        get() = androidPermissions.mapNotNull { permissionTypeFor(it) }.distinct()

    /** True when this build actually implements something for the capability on Android. */
    val implementedOnAndroid: Boolean
        get() = android.status == CapabilityStatus.WORKING || android.status == CapabilityStatus.PARTIAL
}

internal fun permissionTypeFor(androidPermission: String): PermissionType? = when (androidPermission) {
    "android.permission.RECORD_AUDIO" -> PermissionType.MICROPHONE
    "android.permission.READ_CONTACTS" -> PermissionType.CONTACTS
    "android.permission.CALL_PHONE" -> PermissionType.PHONE_CALL
    "android.permission.POST_NOTIFICATIONS" -> PermissionType.NOTIFICATIONS
    "android.permission.ACCESS_COARSE_LOCATION" -> PermissionType.LOCATION
    "android.permission.CAMERA" -> PermissionType.CAMERA
    "android.permission.READ_CALENDAR" -> PermissionType.CALENDAR
    else -> null
}

/**
 * The Phase 1 Capability Registry, loaded from the same `capability-registry.json` the backend
 * serves at GET /api/v1/capabilities and the web Permission Center renders — one source of
 * truth (authored in backend/src/capabilities/registry.ts) for every platform.
 */
class CapabilityRegistry(val capabilities: List<CapabilityDefinition>) {

    fun get(id: CapabilityId): CapabilityDefinition =
        capabilities.first { it.id == id }

    fun find(wireId: String?): CapabilityDefinition? =
        wireId?.let { id -> capabilities.firstOrNull { it.id.wireId == id } }

    /** Capabilities that need a given runtime permission (used for revocation messages). */
    fun usingPermission(permission: PermissionType): List<CapabilityDefinition> =
        capabilities.filter { permission in it.permissionTypes }

    companion object {
        const val RESOURCE = "/capability-registry.json"

        /** Loads the registry packaged on the classpath (see domain/build.gradle.kts). */
        fun loadDefault(): CapabilityRegistry {
            val text = CapabilityRegistry::class.java.getResourceAsStream(RESOURCE)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                ?: error("capability-registry.json is missing from the classpath")
            return parse(text)
        }

        fun parse(json: String): CapabilityRegistry {
            val root = Json.parseToJsonElement(json).jsonObject
            val list = root.getValue("capabilities").jsonArray.map { element ->
                val o = element.jsonObject
                val platforms = o.obj("platforms")
                val rationale = o.obj("rationale")
                CapabilityDefinition(
                    id = CapabilityId.fromWire(o.str("id")) ?: error("Unknown capability id '${o.str("id")}'"),
                    name = o.str("name"),
                    requiredAccess = o.str("requiredAccess"),
                    androidPermissions = o.strings("androidPermissions"),
                    androidRequirements = o.str("androidRequirements"),
                    risk = RiskLevel.valueOf(o.str("risk")),
                    actionClass = ActionClass.valueOf(o.str("actionClass")),
                    dataExposure = o.str("dataExposure"),
                    supportedActions = o.strings("supportedActions"),
                    unsupportedActions = o.strings("unsupportedActions"),
                    confirmation = ConfirmationPolicy.valueOf(o.str("confirmation")),
                    denialBehavior = o.str("denialBehavior"),
                    fallback = o.str("fallback"),
                    revocationHandling = o.str("revocationHandling"),
                    settingsDestination = o.str("settingsDestination"),
                    rationale = PermissionRationale(
                        why = rationale.str("why"),
                        data = rationale.str("data"),
                        notAutomatic = rationale.str("notAutomatic"),
                        revoke = rationale.str("revoke"),
                    ),
                    web = platforms.obj("web").platformState(),
                    android = platforms.obj("android").platformState(),
                )
            }
            require(list.map { it.id }.toSet() == CapabilityId.entries.toSet()) {
                "capability-registry.json must define every CapabilityId exactly once"
            }
            require(list.size == CapabilityId.entries.size) { "Duplicate capability ids in registry" }
            return CapabilityRegistry(list)
        }

        private fun JsonObject.str(key: String): String = getValue(key).jsonPrimitive.content
        private fun JsonObject.obj(key: String): JsonObject = getValue(key).jsonObject
        private fun JsonObject.strings(key: String): List<String> =
            (getValue(key) as JsonArray).map { it.jsonPrimitive.content }
        private fun JsonObject.platformState(): PlatformState =
            PlatformState(CapabilityStatus.valueOf(str("status")), str("note"))
    }
}
