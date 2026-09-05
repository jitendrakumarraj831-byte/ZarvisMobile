package com.zarvismobile.skills

import com.zarvismobile.data.local.reminder.ReminderDao
import com.zarvismobile.data.local.reminder.RoomReminderScheduler
import com.zarvismobile.domain.port.SystemClockPort
import com.zarvismobile.domain.skill.ReminderSkillFactory
import com.zarvismobile.domain.tooling.SkillRegistry

/**
 * Registers every ON-DEVICE skill into a [SkillRegistry] for the Android
 * [com.zarvismobile.domain.tooling.ToolPipeline] to execute. Backend-executed skills
 * (web.search, docs.summarize, developer.analyze_repo — see SKILLS.md) are not registered
 * here: the app displays them from `GET /api/v1/skills` and invokes them via the
 * Orchestrator's remote turn call instead of a local pipeline run.
 *
 * Adding a new on-device skill is exactly this pattern: register it here, never touch the
 * Orchestrator (SKILLS.md "Authoring a new skill").
 */
object OnDeviceSkillRegistryFactory {
    fun create(reminderDao: ReminderDao): SkillRegistry {
        val registry = SkillRegistry()
        registry.register(
            ReminderSkillFactory.create(
                scheduler = RoomReminderScheduler(reminderDao),
                clock = SystemClockPort,
            ),
        )
        return registry
    }
}
