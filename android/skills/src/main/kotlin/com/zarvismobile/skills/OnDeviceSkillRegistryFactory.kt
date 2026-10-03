package com.zarvismobile.skills

import android.content.Context
import com.zarvismobile.core.tooling.AndroidAlarmClockPort
import com.zarvismobile.core.tooling.AndroidAppLauncherPort
import com.zarvismobile.core.tooling.AndroidCalendarInsertPort
import com.zarvismobile.core.tooling.AndroidContactLookupPort
import com.zarvismobile.core.tooling.AndroidLocationPort
import com.zarvismobile.core.tooling.AndroidPhoneCallPort
import com.zarvismobile.core.tooling.AndroidReminderAlarmPort
import com.zarvismobile.core.tooling.AndroidSystemSettingsPort
import com.zarvismobile.data.local.reminder.ReminderDao
import com.zarvismobile.data.local.reminder.RoomReminderScheduler
import com.zarvismobile.domain.port.SystemClockPort
import com.zarvismobile.domain.skill.CameraCapturePort
import com.zarvismobile.domain.skill.DeviceCapabilitySkills
import com.zarvismobile.domain.skill.DocumentPickerPort
import com.zarvismobile.domain.skill.PhoneCallSkillFactory
import com.zarvismobile.domain.skill.PhoneFindContactSkillFactory
import com.zarvismobile.domain.skill.PhoneOpenAppSkillFactory
import com.zarvismobile.domain.skill.PhotoPickerPort
import com.zarvismobile.domain.skill.ReminderSkillFactory
import com.zarvismobile.domain.skill.AssistantRolePort
import com.zarvismobile.domain.skill.NotificationReaderPort
import com.zarvismobile.domain.skill.NotificationSettingsPort
import com.zarvismobile.domain.skill.ScreenAccessPort
import com.zarvismobile.domain.skill.SpecialAccessSkills
import com.zarvismobile.domain.skill.UsageStatsPort
import com.zarvismobile.domain.tooling.SkillRegistry

/** Activity-bound ports (system pickers/camera need an Activity result launcher, owned by `app`). */
data class ActivityPorts(
    val documents: DocumentPickerPort,
    val photos: PhotoPickerPort,
    val camera: CameraCapturePort,
)

/** Special-access ports (notification listener, accessibility, usage access, assistant role), owned by `app`. */
data class SpecialAccessPorts(
    val notifications: NotificationReaderPort,
    val notificationSettings: NotificationSettingsPort,
    val screen: ScreenAccessPort,
    val usage: UsageStatsPort,
    val assistantRole: AssistantRolePort,
)

/**
 * Registers every ON-DEVICE skill for the Android ToolPipeline. Backend-executed skills are not
 * registered here: they run through the shared Brain via the orchestrator turn call.
 */
object OnDeviceSkillRegistryFactory {
    fun create(reminderDao: ReminderDao, context: Context, activityPorts: ActivityPorts, special: SpecialAccessPorts): SkillRegistry {
        val registry = SkillRegistry()
        val clock = SystemClockPort
        registry.register(
            ReminderSkillFactory.create(
                scheduler = RoomReminderScheduler(reminderDao, AndroidReminderAlarmPort(context)),
                clock = clock,
            ),
        )

        val contacts = AndroidContactLookupPort(context)
        registry.register(PhoneOpenAppSkillFactory.create(AndroidAppLauncherPort(context)))
        registry.register(PhoneFindContactSkillFactory.create(contacts))
        registry.register(PhoneCallSkillFactory.create(contacts, AndroidPhoneCallPort(context)))

        val settings = AndroidSystemSettingsPort(context)
        registry.register(DeviceCapabilitySkills.pickDocument(activityPorts.documents))
        registry.register(DeviceCapabilitySkills.pickPhoto(activityPorts.photos))
        registry.register(DeviceCapabilitySkills.capturePhoto(activityPorts.camera))
        registry.register(DeviceCapabilitySkills.currentLocation(AndroidLocationPort(context), clock))
        registry.register(DeviceCapabilitySkills.openBluetoothSettings(settings))
        registry.register(DeviceCapabilitySkills.openSystemSettings(settings))
        registry.register(DeviceCapabilitySkills.setAlarm(AndroidAlarmClockPort(context), clock))
        registry.register(DeviceCapabilitySkills.createCalendarEvent(AndroidCalendarInsertPort(context), clock))

        registry.register(SpecialAccessSkills.readNotifications(special.notifications, special.notificationSettings))
        registry.register(SpecialAccessSkills.speakNotificationsOn(special.notificationSettings))
        registry.register(SpecialAccessSkills.speakNotificationsOff(special.notificationSettings))
        registry.register(SpecialAccessSkills.screenTime(special.usage))
        registry.register(SpecialAccessSkills.globalAction(special.screen))
        registry.register(SpecialAccessSkills.readScreen(special.screen))
        registry.register(SpecialAccessSkills.tapOnScreen(special.screen))
        registry.register(SpecialAccessSkills.assistantSetup(special.assistantRole))

        return registry
    }
}
