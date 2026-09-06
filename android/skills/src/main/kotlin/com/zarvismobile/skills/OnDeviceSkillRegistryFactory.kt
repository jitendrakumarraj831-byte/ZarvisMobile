package com.zarvismobile.skills

import android.content.Context
import com.zarvismobile.core.tooling.AndroidAppLauncherPort
import com.zarvismobile.core.tooling.AndroidContactLookupPort
import com.zarvismobile.core.tooling.AndroidPhoneCallPort
import com.zarvismobile.data.local.reminder.ReminderDao
import com.zarvismobile.data.local.reminder.RoomReminderScheduler
import com.zarvismobile.domain.port.SystemClockPort
import com.zarvismobile.domain.skill.PhoneCallSkillFactory
import com.zarvismobile.domain.skill.PhoneFindContactSkillFactory
import com.zarvismobile.domain.skill.PhoneOpenAppSkillFactory
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
    fun create(reminderDao: ReminderDao, context: Context): SkillRegistry {
        val registry = SkillRegistry()
        registry.register(
            ReminderSkillFactory.create(
                scheduler = RoomReminderScheduler(reminderDao),
                clock = SystemClockPort,
            ),
        )

        val contacts = AndroidContactLookupPort(context)
        registry.register(PhoneOpenAppSkillFactory.create(AndroidAppLauncherPort(context)))
        registry.register(PhoneFindContactSkillFactory.create(contacts))
        registry.register(PhoneCallSkillFactory.create(contacts, AndroidPhoneCallPort(context)))

        return registry
    }
}
