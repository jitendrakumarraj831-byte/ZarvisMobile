package com.zarvismobile.domain.orchestrator

import com.zarvismobile.domain.skill.AppSearchSkillFactory
import com.zarvismobile.domain.skill.DeviceCapabilitySkills
import com.zarvismobile.domain.skill.MessageDraftSkillFactory
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
        register(DeviceCapabilitySkills.describePhoto(stub(), stub()))
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
        register(MessageDraftSkillFactory.create(stub(), stub()))
        register(AppSearchSkillFactory.create(stub()))
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
    fun callMeLaterGoesToTheBrainButARealCallStillRoutes() {
        assertNull(route("call me later"))
        assertNull(route("call it a day"))
        assertEquals("phone.call", route("call Mom"))
        assertEquals("phone.call", route("call 112"))
        assertEquals("phone.find_contact", route("what is mom's number"))
        assertEquals("phone.find_contact", route("mom ka number batao"))
    }

    @Test
    fun aWritingRequestThatMerelyMentionsAPhotoStaysWithTheBrain() {
        assertNull(route("write a poem describing a photo of my dog"))
        assertNull(route("how do i describe a photo in an essay"))
        assertNull(route("describe a sunset"))
    }

    @Test
    fun explicitDeviceCommandsStillRouteToTheirSkill() {
        assertEquals("files.pick_document", route("pick a document"))
        assertEquals("files.pick_document", route("choose a file to read"))
        assertEquals("photos.pick_photo", route("pick a photo from my gallery"))
        assertEquals("camera.capture_photo", route("take a photo"))
        assertEquals("camera.capture_photo", route("selfie lo"))
        assertEquals("photos.describe_photo", route("describe a photo"))
        assertEquals("photos.describe_photo", route("please describe this photo for me"))
        assertEquals("photos.describe_photo", route("what's in this photo"))
        assertEquals("photos.describe_photo", route("photo mein kya hai"))
        assertEquals("location.current", route("where am i"))
        assertEquals("location.current", route("meri location batao"))
        assertEquals("personal.reminder", route("remind me to call mom at 8pm"))
        assertEquals("alarm.set", route("set an alarm for 6am"))
        assertEquals("phone.call", route("call 9876543210"))
        assertEquals("phone.open_app", route("open whatsapp"))
        assertEquals("bluetooth.open_settings", route("open bluetooth settings"))
    }

    /** Regression: "call" and "set an alarm" outscored the reminder, so these rang a contact named "mummy karne yaad dilana" or set an alarm. */
    @Test
    fun aReminderAboutCallingOrSettingAnAlarmIsAReminder() {
        assertEquals("personal.reminder", route("mummy ko call karne ki yaad dilana"))
        assertEquals("personal.reminder", route("Rahul ko call karna yaad dilana 5 baje"))
        assertEquals("personal.reminder", route("remind me to set an alarm"))
        assertEquals("personal.reminder", route("remind me to set an alarm at 9pm"))
        // The plain commands still go where they did.
        assertEquals("phone.call", route("mummy ko call karo"))
        assertEquals("phone.call", route("call mom to remind her about dinner"))
        assertEquals("alarm.set", route("kal subah 6 baje alarm laga do"))
        assertEquals("alarm.set", route("set an alarm for 6am"))
    }

    /** Regression: "open WhatsApp and then Rahul's chat" (a multi-step request for the Brain) tried to open an app of that whole name. */
    @Test
    fun anOpenCommandWithAFurtherStepGoesToTheBrain() {
        assertNull(route("open whatsapp and then rahul's chat"))
        assertNull(route("open whatsapp and call rahul"))
        assertNull(route("WhatsApp kholo aur Rahul ka chat kholo"))
        assertNull(route("whatsapp kholo phir rahul ko message karo"))
        assertEquals("phone.open_app", route("open whatsapp"))
        assertEquals("phone.open_app", route("whatsapp kholo"))
        assertEquals("phone.open_app", route("chrome kholo na"))
        assertEquals("phone.open_app", route("open google maps"))
    }

    /**
     * A reminder request that starts with its time ("kal subah 8 baje … reminder set kar do") is not one the phone's own words take: it
     * goes to the Brain, which hands personal.reminder back with a title of its own (ReminderBrainHandoffTest covers what happens then).
     */
    @Test
    fun aReminderRequestThatStartsWithItsTimeGoesToTheBrain() {
        for (text in listOf(
            "kal subah 8 baje mummy ko call karne ka reminder set kar do",
            "2 ghante baad dawai lene ka reminder set karo",
            "1 minute baad paani peene ka reminder set karo",
            "roz shaam ko paani peene ka reminder set karo",
        )) {
            assertNull(route(text), text)
        }
    }

    /** Regression: these were taken as new reminders, and the user was asked "When should I remind you?". */
    @Test
    fun askingWhichRemindersThereAreListsThem() {
        for (text in listOf("what reminders do I have", "any reminders today?", "kal ke reminders dikhao", "show my reminders")) {
            val skill = assertNotNull(matcher.matchCommand(text), text)
            assertEquals("personal.reminder", skill.id, text)
            assertEquals("list", OnDeviceInputBuilder.build(skill, text).values["action"], text)
        }
        val reminder = assertNotNull(registry.find("personal.reminder"))
        assertEquals("create", OnDeviceInputBuilder.build(reminder, "remind me to check my reminders at 5pm").values["action"])
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
