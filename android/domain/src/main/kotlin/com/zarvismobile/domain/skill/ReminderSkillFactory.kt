package com.zarvismobile.domain.skill

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
import java.time.format.DateTimeParseException
import java.util.UUID

/**
 * The `personal.reminder` reference skill — LOW risk, free, on-device. See SKILLS.md
 * "Current catalogue" and MASTER_SPEC.md §29 (MVP Scope).
 */
object ReminderSkillFactory {

    fun create(scheduler: ReminderSchedulerPort, clock: ClockPort): SkillDefinition = SkillDefinition(
        id = "personal.reminder",
        name = "Reminder",
        description = "Create, list, or complete a personal reminder, e.g. \"remind me to call mom tomorrow at 8am\".",
        category = SkillCategory.PERSONAL,
        capabilities = listOf("remind", "reminder", "याद दिला", "yaad dila", "yaad dilao"),
        requiredPermissions = listOf(PermissionType.NOTIFICATIONS),
        requiredEntitlement = EntitlementLevel.FREE,
        usageCost = UsageCost.FREE,
        riskLevel = RiskLevel.LOW,
        requiresConfirmation = false,
        executesOnDevice = true,
        inputSchema = JsonSchema(requiredFields = setOf("action")),
        handler = handler(scheduler, clock),
    )

    private fun handler(scheduler: ReminderSchedulerPort, clock: ClockPort) = SkillHandler { input, _ ->
        when (input.values["action"] as? String) {
            "create" -> create(scheduler, clock, input.values)
            "list" -> list(scheduler)
            "complete" -> complete(scheduler, input.values)
            else -> SkillResult.Failure(
                reason = "invalid_action",
                userMessage = "I couldn't tell whether to create, list, or complete a reminder.",
            )
        }
    }

    private suspend fun create(
        scheduler: ReminderSchedulerPort,
        clock: ClockPort,
        values: Map<String, Any?>,
    ): SkillResult {
        val title = (values["title"] as? String)?.trim()
        if (title.isNullOrEmpty()) {
            return SkillResult.Failure("missing_title", "Please tell me what to remind you about.")
        }
        val dueAt = parseDueAt(values["dueAt"] as? String) ?: clock.now().plusSeconds(3600)
        val reminder = scheduler.schedule(Reminder(id = UUID.randomUUID().toString(), title = title, dueAt = dueAt))
        return SkillResult.Success(
            output = mapOf("reminderId" to reminder.id, "dueAt" to reminder.dueAt.toString()),
            summary = "Reminder set: \"$title\".",
        )
    }

    private suspend fun list(scheduler: ReminderSchedulerPort): SkillResult {
        val reminders = scheduler.list()
        return SkillResult.Success(
            output = mapOf("reminders" to reminders),
            summary = if (reminders.isEmpty()) "You have no reminders." else "You have ${reminders.size} reminder(s).",
        )
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

    private fun parseDueAt(raw: String?): Instant? {
        if (raw.isNullOrBlank()) return null
        return try {
            Instant.parse(raw)
        } catch (e: DateTimeParseException) {
            null
        }
    }
}
