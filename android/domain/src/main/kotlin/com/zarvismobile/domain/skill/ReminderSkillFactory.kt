package com.zarvismobile.domain.skill

import com.zarvismobile.domain.entity.ActionClass
import com.zarvismobile.domain.entity.EntitlementLevel
import com.zarvismobile.domain.entity.JsonSchema
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.entity.Reminder
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
import java.time.format.DateTimeParseException
import java.util.Locale
import java.util.UUID

/**
 * `personal.reminder` — LOW risk, free, on-device, capability `alarms`. A reminder is only
 * created when a due time was actually stated (parsed by [ReminderTimeParser]) or passed as an
 * ISO instant; otherwise the user is asked for the time. The summary always states the time
 * the reminder will fire, so the user can see exactly what was scheduled.
 */
object ReminderSkillFactory {

    private val DISPLAY = DateTimeFormatter.ofPattern("EEE d MMM, h:mm a", Locale.ENGLISH)

    fun create(
        scheduler: ReminderSchedulerPort,
        clock: ClockPort,
        zone: () -> ZoneId = { ZoneId.systemDefault() },
    ): SkillDefinition = SkillDefinition(
        id = "personal.reminder",
        name = "Reminder",
        description = "Create or list personal reminders, e.g. \"remind me to call mom tomorrow at 8am\".",
        category = SkillCategory.PERSONAL,
        capabilities = listOf("remind", "reminder", "याद दिला", "yaad dila", "yaad dilao"),
        requiredPermissions = listOf(PermissionType.NOTIFICATIONS),
        requiredEntitlement = EntitlementLevel.FREE,
        usageCost = UsageCost.FREE,
        riskLevel = RiskLevel.LOW,
        actionClass = ActionClass.LOW_IMPACT,
        capabilityId = "alarms",
        requiresConfirmation = false,
        executesOnDevice = true,
        inputSchema = JsonSchema(requiredFields = setOf("action")),
        handler = handler(scheduler, clock, zone),
    )

    private fun handler(scheduler: ReminderSchedulerPort, clock: ClockPort, zone: () -> ZoneId) = SkillHandler { input, _ ->
        when (input.values["action"] as? String) {
            "create" -> create(scheduler, clock, zone(), input.values)
            "list" -> list(scheduler, clock, zone())
            "complete" -> complete(scheduler, input.values)
            else -> SkillResult.Failure(
                reason = "invalid_action",
                userMessage = "I couldn't tell whether to create or list a reminder.",
            )
        }
    }

    private suspend fun create(
        scheduler: ReminderSchedulerPort,
        clock: ClockPort,
        zone: ZoneId,
        values: Map<String, Any?>,
    ): SkillResult {
        val raw = (values["title"] as? String)?.trim()
        if (raw.isNullOrEmpty()) {
            return SkillResult.Failure("missing_title", "Please tell me what to remind you about.")
        }
        val now = ZonedDateTime.ofInstant(clock.now(), zone)
        val explicit = parseInstant(values["dueAt"] as? String)
        val (dueAt, title) = if (explicit != null) {
            explicit to raw
        } else {
            when (val parsed = ReminderTimeParser.parse(raw, now)) {
                is ReminderTimeParser.Result.Parsed -> parsed.dueAt.toInstant() to parsed.title
                is ReminderTimeParser.Result.InPast -> return SkillResult.Failure(
                    reason = "time_in_past",
                    userMessage = "${DISPLAY.format(parsed.dueAt)} has already passed. When should I remind you instead?",
                )
                is ReminderTimeParser.Result.NoTime -> return SkillResult.Failure(
                    reason = "missing_time",
                    userMessage = "When should I remind you? For example \"at 6 pm\", \"tomorrow at 8 am\" or \"in 30 minutes\".",
                )
            }
        }
        if (!dueAt.isAfter(clock.now())) {
            return SkillResult.Failure("time_in_past", "That time has already passed. When should I remind you instead?")
        }
        val finalTitle = title.ifBlank { "Reminder" }
        val reminder = scheduler.schedule(Reminder(id = UUID.randomUUID().toString(), title = finalTitle, dueAt = dueAt))
        val whenText = DISPLAY.format(ZonedDateTime.ofInstant(reminder.dueAt, zone))
        return SkillResult.Success(
            output = mapOf("reminderId" to reminder.id, "dueAt" to reminder.dueAt.toString(), "title" to finalTitle),
            summary = "Reminder set for $whenText: \"$finalTitle\".",
            evidence = mapOf("storedReminderId" to reminder.id, "alarmScheduledFor" to reminder.dueAt.toString()),
        )
    }

    private suspend fun list(scheduler: ReminderSchedulerPort, clock: ClockPort, zone: ZoneId): SkillResult {
        val upcoming = scheduler.list().filter { !it.completed && it.dueAt.isAfter(clock.now()) }.sortedBy { it.dueAt }
        val summary = if (upcoming.isEmpty()) {
            "You have no upcoming reminders."
        } else {
            "You have ${upcoming.size} upcoming reminder(s): " +
                upcoming.take(5).joinToString("; ") { "${DISPLAY.format(ZonedDateTime.ofInstant(it.dueAt, zone))} — ${it.title}" }
        }
        return SkillResult.Success(output = mapOf("reminders" to upcoming), summary = summary)
    }

    private suspend fun complete(scheduler: ReminderSchedulerPort, values: Map<String, Any?>): SkillResult {
        val id = values["id"] as? String
        if (id.isNullOrEmpty()) {
            return SkillResult.Failure("missing_id", "Which reminder should I mark as done?")
        }
        return if (scheduler.complete(id)) {
            SkillResult.Success(output = mapOf("reminderId" to id), summary = "Reminder marked as done.")
        } else {
            SkillResult.Failure("not_found", "I couldn't find that reminder.")
        }
    }

    private fun parseInstant(raw: String?): Instant? {
        if (raw.isNullOrBlank()) return null
        return try {
            Instant.parse(raw)
        } catch (e: DateTimeParseException) {
            null
        }
    }
}
