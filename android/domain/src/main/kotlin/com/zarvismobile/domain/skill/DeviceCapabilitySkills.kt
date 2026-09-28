package com.zarvismobile.domain.skill

import com.zarvismobile.domain.entity.ActionClass
import com.zarvismobile.domain.entity.EntitlementLevel
import com.zarvismobile.domain.entity.JsonSchema
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.entity.RiskLevel
import com.zarvismobile.domain.entity.SkillCategory
import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.SkillHandler
import com.zarvismobile.domain.entity.SkillResult
import com.zarvismobile.domain.entity.UsageCost
import com.zarvismobile.domain.port.ClockPort
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Phase 1 device-capability skills. Every one runs on-device through the ToolPipeline, uses
 * the narrowest Android route available (system pickers/intents that need no dangerous
 * permission wherever possible), and reports truthfully: a hand-off to a system app is
 * USER_ACTION_REQUIRED, never COMPLETED, because ZARVIS cannot see whether the user finished.
 */
object DeviceCapabilitySkills {

    private val TIME = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)
    private val DATE_TIME = DateTimeFormatter.ofPattern("EEE d MMM, h:mm a", Locale.ENGLISH)

    private fun base(
        id: String,
        name: String,
        description: String,
        capabilities: List<String>,
        capabilityId: String?,
        risk: RiskLevel,
        actionClass: ActionClass,
        permissions: List<PermissionType> = emptyList(),
        required: Set<String> = emptySet(),
        handler: SkillHandler,
    ) = SkillDefinition(
        id = id,
        name = name,
        description = description,
        category = SkillCategory.PHONE,
        capabilities = capabilities,
        requiredPermissions = permissions,
        requiredEntitlement = EntitlementLevel.FREE,
        usageCost = UsageCost.FREE,
        riskLevel = risk,
        actionClass = actionClass,
        capabilityId = capabilityId,
        requiresConfirmation = false,
        executesOnDevice = true,
        inputSchema = JsonSchema(requiredFields = required),
        handler = handler,
    )

    fun pickDocument(picker: DocumentPickerPort) = base(
        id = "files.pick_document",
        name = "Pick a document",
        description = "Choose one document with the system file picker, e.g. \"pick a file\".",
        capabilities = listOf("pick a file", "choose a file", "select a file", "pick a document", "choose a document", "select a document", "file chuno", "document chuno"),
        capabilityId = "files",
        risk = RiskLevel.MEDIUM,
        actionClass = ActionClass.READ_ONLY,
        handler = SkillHandler { _, _ -> pickResult(picker.pickDocument(), "document") },
    )

    fun pickPhoto(picker: PhotoPickerPort) = base(
        id = "photos.pick_photo",
        name = "Pick a photo",
        description = "Choose one photo with the system photo picker, e.g. \"choose a photo\".",
        capabilities = listOf("pick a photo", "choose a photo", "select a photo", "pick a picture", "choose a picture", "photo chuno", "gallery se photo"),
        capabilityId = "photos",
        risk = RiskLevel.MEDIUM,
        actionClass = ActionClass.READ_ONLY,
        handler = SkillHandler { _, _ -> pickResult(picker.pickPhoto(), "photo") },
    )

    private fun pickResult(result: PickResult, kind: String): SkillResult = when (result) {
        is PickResult.Picked -> SkillResult.Success(
            output = mapOf("displayName" to result.displayName, "mimeType" to result.mimeType, "sizeBytes" to result.sizeBytes),
            summary = "You picked \"${result.displayName}\"" +
                listOfNotNull(result.mimeType, result.sizeBytes?.let { humanSize(it) }).joinToString(", ", " (", ")").takeIf { result.mimeType != null || result.sizeBytes != null }.orEmpty() +
                ". ZARVIS has not uploaded it or read its contents.",
            evidence = mapOf("pickerReturnedUri" to result.uri),
        )
        PickResult.Cancelled -> SkillResult.Failure("cancelled", "No $kind was picked, so nothing was read.")
        is PickResult.Unavailable -> SkillResult.Failure("unavailable", result.reason)
    }

    fun capturePhoto(camera: CameraCapturePort) = base(
        id = "camera.capture_photo",
        name = "Take a photo",
        description = "Take a photo with the phone's camera app, e.g. \"take a photo\".",
        capabilities = listOf("take a photo", "take a picture", "click a photo", "click a picture", "photo khincho", "photo kheecho", "photo lo", "selfie lo"),
        capabilityId = "camera",
        risk = RiskLevel.MEDIUM,
        actionClass = ActionClass.READ_ONLY,
        handler = SkillHandler { _, _ ->
            when (val result = camera.capturePreview()) {
                is CaptureResult.Captured -> SkillResult.Success(
                    output = mapOf("width" to result.width, "height" to result.height),
                    summary = "Photo taken (${result.width}×${result.height} preview). It was not saved or uploaded by ZARVIS.",
                    evidence = mapOf("cameraReturnedBitmap" to "${result.width}x${result.height}"),
                )
                CaptureResult.Cancelled -> SkillResult.Failure("cancelled", "The camera was closed without taking a photo.")
                is CaptureResult.Unavailable -> SkillResult.Failure("unavailable", result.reason)
            }
        },
    )

    fun currentLocation(location: LocationPort, clock: ClockPort, zone: () -> ZoneId = { ZoneId.systemDefault() }) = base(
        id = "location.current",
        name = "My location",
        description = "Show your approximate current location, e.g. \"where am I\".",
        capabilities = listOf("where am i", "my location", "current location", "meri location", "main kahan hoon", "मैं कहाँ हूँ", "मेरी लोकेशन"),
        capabilityId = "location",
        risk = RiskLevel.MEDIUM,
        actionClass = ActionClass.READ_ONLY,
        permissions = listOf(PermissionType.LOCATION),
        handler = SkillHandler { _, _ ->
            when (val result = location.currentCoarseLocation()) {
                is LocationResult.Located -> {
                    val ageMinutes = (clock.now().toEpochMilli() - result.fixTimeEpochMillis) / 60_000
                    val fixAt = TIME.format(ZonedDateTime.ofInstant(Instant.ofEpochMilli(result.fixTimeEpochMillis), zone()))
                    SkillResult.Success(
                        output = mapOf("latitude" to result.latitude, "longitude" to result.longitude, "accuracyMeters" to result.accuracyMeters),
                        summary = "Your approximate location is %.3f, %.3f".format(Locale.ENGLISH, result.latitude, result.longitude) +
                            (result.accuracyMeters?.let { " (within about ${"%.1f".format(Locale.ENGLISH, it / 1000f)} km)" } ?: "") +
                            ", from a $fixAt fix${if (ageMinutes >= 2) " ($ageMinutes min old)" else ""}. It was not shared.",
                        evidence = mapOf("provider" to result.provider, "fixTimeEpochMillis" to result.fixTimeEpochMillis.toString()),
                    )
                }
                is LocationResult.Unavailable -> SkillResult.Failure(
                    if (result.userActionRequired) "location_services_off" else "location_unavailable",
                    result.reason,
                )
            }
        },
    )

    fun openBluetoothSettings(settings: SystemSettingsPort) = base(
        id = "bluetooth.open_settings",
        name = "Bluetooth settings",
        description = "Open Bluetooth settings so you can connect a device, e.g. \"open bluetooth\".",
        capabilities = listOf("bluetooth", "ब्लूटूथ"),
        capabilityId = "bluetooth",
        risk = RiskLevel.MEDIUM,
        actionClass = ActionClass.LOW_IMPACT,
        handler = SkillHandler { _, _ -> handOff(settings.open(SettingsPanel.BLUETOOTH), "Bluetooth settings") },
    )

    fun openSystemSettings(settings: SystemSettingsPort) = base(
        id = "device.open_settings",
        name = "System settings",
        description = "Open a supported system settings screen (Wi-Fi, location), e.g. \"open wifi settings\".",
        capabilities = listOf("wifi", "wi-fi", "location settings", "gps settings"),
        capabilityId = null,
        risk = RiskLevel.LOW,
        actionClass = ActionClass.LOW_IMPACT,
        required = setOf("panel"),
        handler = SkillHandler { input, _ ->
            val panel = runCatching { SettingsPanel.valueOf((input.values["panel"] as? String).orEmpty()) }.getOrNull()
                ?: return@SkillHandler SkillResult.Failure("unsupported_panel", "I can open Wi-Fi, Bluetooth or location settings.")
            handOff(settings.open(panel), panel.name.lowercase().replace('_', ' ').replace("wifi", "Wi-Fi") + " settings")
        },
    )

    private fun handOff(opened: Boolean, what: String): SkillResult =
        if (opened) {
            SkillResult.Success(
                output = mapOf("opened" to what),
                summary = "I opened $what. Make the change there — ZARVIS doesn't change it for you.",
                userActionRequired = true,
                evidence = mapOf("systemIntentAccepted" to what),
            )
        } else {
            SkillResult.Failure("unavailable", "This phone couldn't open $what.")
        }

    fun setAlarm(clockApp: AlarmClockPort, clock: ClockPort, zone: () -> ZoneId = { ZoneId.systemDefault() }) = base(
        id = "alarm.set",
        name = "Set alarm",
        description = "Hand an alarm to the Clock app, e.g. \"set an alarm for 6 am\".",
        capabilities = listOf("alarm", "अलार्म"),
        capabilityId = "alarms",
        risk = RiskLevel.LOW,
        actionClass = ActionClass.LOW_IMPACT,
        required = setOf("utterance"),
        handler = SkillHandler { input, _ ->
            val text = (input.values["utterance"] as? String).orEmpty()
            val now = ZonedDateTime.ofInstant(clock.now(), zone())
            val time = when (val parsed = ReminderTimeParser.parse(text, now)) {
                is ReminderTimeParser.Result.Parsed -> parsed.dueAt
                else -> return@SkillHandler SkillResult.Failure("missing_time", "What time should the alarm be for? For example \"6:30 am\".")
            }
            if (!clockApp.handOffAlarm(time.hour, time.minute, "ZARVIS")) {
                return@SkillHandler SkillResult.Failure("no_clock_app", "No Clock app on this phone accepted the alarm.")
            }
            SkillResult.Success(
                output = mapOf("hour" to time.hour, "minute" to time.minute),
                summary = "I asked the Clock app to set an alarm for ${TIME.format(time)}. Check the Clock app — ZARVIS can't confirm it was saved.",
                userActionRequired = true,
                evidence = mapOf("clockAppAcceptedIntent" to "ACTION_SET_ALARM"),
            )
        },
    )

    fun createCalendarEvent(calendar: CalendarInsertPort, clock: ClockPort, zone: () -> ZoneId = { ZoneId.systemDefault() }) = base(
        id = "calendar.create_event",
        name = "Calendar event",
        description = "Open a pre-filled event in your calendar app for you to save, e.g. \"add a meeting tomorrow at 5 pm to my calendar\".",
        capabilities = listOf("calendar", "add event", "add an event", "schedule a meeting", "कैलेंडर"),
        capabilityId = "calendar",
        risk = RiskLevel.MEDIUM,
        actionClass = ActionClass.LOW_IMPACT,
        required = setOf("utterance"),
        handler = SkillHandler { input, _ ->
            val text = (input.values["utterance"] as? String).orEmpty()
            val now = ZonedDateTime.ofInstant(clock.now(), zone())
            val parsed = ReminderTimeParser.parse(text, now) as? ReminderTimeParser.Result.Parsed
                ?: return@SkillHandler SkillResult.Failure("missing_time", "When is the event? For example \"tomorrow at 5 pm\".")
            val title = parsed.title
                .replace(Regex("""\b(add|create|schedule|put|an?|to|in|on|my|the|calendar|event)\b""", RegexOption.IGNORE_CASE), " ")
                .replace(Regex("""\s+"""), " ").trim().ifBlank { "Event" }
            val start = parsed.dueAt.toInstant().toEpochMilli()
            if (!calendar.handOffEvent(title, start, start + 60 * 60 * 1000)) {
                return@SkillHandler SkillResult.Failure("no_calendar_app", "No calendar app on this phone accepted the event.")
            }
            SkillResult.Success(
                output = mapOf("title" to title, "start" to parsed.dueAt.toString()),
                summary = "I opened your calendar with \"$title\" on ${DATE_TIME.format(parsed.dueAt)}. Tap Save there to add it.",
                userActionRequired = true,
                evidence = mapOf("calendarAppAcceptedIntent" to "ACTION_INSERT"),
            )
        },
    )

    private fun humanSize(bytes: Long): String = when {
        bytes >= 1024 * 1024 -> "%.1f MB".format(Locale.ENGLISH, bytes / (1024.0 * 1024.0))
        bytes >= 1024 -> "${bytes / 1024} KB"
        else -> "$bytes bytes"
    }
}
