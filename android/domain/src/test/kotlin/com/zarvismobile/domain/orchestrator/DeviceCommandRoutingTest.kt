package com.zarvismobile.domain.orchestrator

import com.zarvismobile.domain.skill.DeviceCapabilitySkills
import com.zarvismobile.domain.skill.PhoneCallSkillFactory
import com.zarvismobile.domain.skill.PhoneFindContactSkillFactory
import com.zarvismobile.domain.skill.PhoneOpenAppSkillFactory
import com.zarvismobile.domain.skill.ReminderSkillFactory
import com.zarvismobile.domain.skill.SpecialAccessSkills
import com.zarvismobile.domain.tooling.SkillRegistry
import java.lang.reflect.Proxy
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * Routing with the app's real on-device catalogue (same skills as
 * skills/OnDeviceSkillRegistryFactory). Ports are inert stubs: routing never calls them.
 *
 * Regression: skill names matched ANY of their words as a substring, so "Pick a document",
 * "Pick a photo" and "Take a photo" matched nearly every sentence via "a", and their gates
 * accept any non-question — "Write a short product description" opened the document picker
 * instead of going to the Brain. Found by the emulator lifecycle test (phase F).
 */
class DeviceCommandRoutingTest {
    private inline fun <reified T : Any> stub(): T =
        Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, method, _ ->
            when (method.returnType) {
                java.lang.Boolean.TYPE -> false
                java.lang.Integer.TYPE -> 0
                java.lang.Long.TYPE -> 0L
                else -> null
            }
        } as T

    private val registry = SkillRegistry().apply {
        register(ReminderSkillFactory.create(stub(), stub()))
        register(PhoneOpenAppSkillFactory.create(stub()))
        register(PhoneFindContactSkillFactory.create(stub()))
        register(PhoneCallSkillFactory.create(stub(), stub()))
        register(DeviceCapabilitySkills.pickDocument(stub()))
        register(DeviceCapabilitySkills.pickPhoto(stub()))
        register(DeviceCapabilitySkills.capturePhoto(stub()))
        register(DeviceCapabilitySkills.currentLocation(stub(), stub()))
        register(DeviceCapabilitySkills.openBluetoothSettings(stub()))
        register(DeviceCapabilitySkills.openSystemSettings(stub()))
        register(DeviceCapabilitySkills.setAlarm(stub(), stub()))
        register(DeviceCapabilitySkills.createCalendarEvent(stub(), stub()))
        register(SpecialAccessSkills.readNotifications(stub(), stub()))
        register(SpecialAccessSkills.speakNotificationsOn(stub()))
        register(SpecialAccessSkills.speakNotificationsOff(stub()))
        register(SpecialAccessSkills.screenTime(stub()))
        register(SpecialAccessSkills.globalAction(stub()))
        register(SpecialAccessSkills.readScreen(stub()))
        register(SpecialAccessSkills.tapOnScreen(stub()))
        register(SpecialAccessSkills.assistantSetup(stub()))
    }
    private val matcher = KeywordSkillMatcher(registry)
    private fun route(text: String) = matcher.matchCommand(text)?.id

    @Test
    fun ordinaryRequestsGoToTheBrainNotToAPickerCameraOrLocation() {
        // Home's quick-category examples and everyday chat (English, Hinglish).
        for (text in listOf(
            "Write a short product description",
            "Find the best phone under 20000",
            "Research the top 3 competitors",
            "kal Forbesganj ka weather kaisa rahega",
            "ek poem likho barish par",
            "Write a message to my team about the launch",
            "Make a plan for my day",
            "Translate this into Hindi",
            "Draft an email to the landlord",
        )) {
            assertNull(route(text), "\"$text\" must go to the Brain, got ${route(text)}")
        }
    }

    @Test
    fun explicitDeviceCommandsStillRouteToTheirSkill() {
        assertEquals("files.pick_document", route("pick a document"))
        assertEquals("files.pick_document", route("choose a file to read"))
        assertEquals("photos.pick_photo", route("pick a photo from my gallery"))
        assertEquals("camera.capture_photo", route("take a photo"))
        assertEquals("camera.capture_photo", route("selfie lo"))
        assertEquals("location.current", route("where am i"))
        assertEquals("location.current", route("meri location batao"))
        assertEquals("personal.reminder", route("remind me to call mom at 8pm"))
        assertEquals("alarm.set", route("set an alarm for 6am"))
        assertEquals("phone.call", route("call 9876543210"))
        assertEquals("phone.open_app", route("open whatsapp"))
        assertEquals("bluetooth.open_settings", route("open bluetooth settings"))
    }

    @Test
    fun everyCommandTheEmulatorSuiteSendsStillRoutesToASkill() {
        // The utterances DeviceCapabilityTest / SpecialAccessTest send on the emulator.
        for (text in listOf(
            "where am i", "set an alarm for 6:30 am", "open bluetooth settings", "read my notifications",
            "add a meeting tomorrow at 5 pm to my calendar", "remind me to drink water in 1 minute",
            "speak my notifications", "stop speaking notifications", "pick a file", "pick a photo",
            "take a photo", "what's my screen time today", "tap Timer", "go home", "read my screen",
            "tap Apps", "make zarvis my default assistant",
        )) {
            assertNotNull(route(text), "\"$text\" must still reach its on-device skill")
        }
    }
}
