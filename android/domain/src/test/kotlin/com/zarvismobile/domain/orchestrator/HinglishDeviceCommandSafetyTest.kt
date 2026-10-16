package com.zarvismobile.domain.orchestrator

import com.zarvismobile.domain.capability.ActionPolicy
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.capability.ConfirmationPolicy
import com.zarvismobile.domain.skill.DeviceCapabilitySkills
import com.zarvismobile.domain.skill.PhoneCallSkillFactory
import com.zarvismobile.domain.skill.PhoneFindContactSkillFactory
import com.zarvismobile.domain.skill.PhoneOpenAppSkillFactory
import com.zarvismobile.domain.skill.ReminderSkillFactory
import com.zarvismobile.domain.skill.SpecialAccessSkills
import com.zarvismobile.domain.tooling.SkillRegistry
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.lang.reflect.Proxy

/**
 * Phase 1 reliability: how Hindi and Hinglish voice commands reach the phone's own skills, with the app's real on-device catalogue
 * (the same skills as skills/OnDeviceSkillRegistryFactory; ports are inert, routing never calls them).
 *
 * Pinned here: the commands that already work, that a sentence which says NOT to call (or asks how to) never opens the call flow,
 * and that whatever a sentence is routed to, an action the registry marks per-action still asks first. Commands that do not reach a
 * device skill yet ("WhatsApp kholo", "मम्मी को कॉल करो") go to the Brain, which cannot act on the phone; they are listed in
 * ZARVIS_ASSISTANT_UPGRADE_PLAN.md for the Phone Agent phase rather than pinned here.
 */
class HinglishDeviceCommandSafetyTest {
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
    }
    private val matcher = KeywordSkillMatcher(registry)
    private val capabilities = CapabilityRegistry.loadDefault()

    private fun route(text: String) = matcher.matchCommand(text)
    private fun input(text: String) = route(text)?.let { OnDeviceInputBuilder.build(it, text).values }

    @Test
    fun `Hinglish commands that work today keep reaching their skill with the right input`() {
        val expected = listOf(
            Triple("mummy ko call karo", "phone.call", mapOf("target" to "mummy")),
            Triple("Rahul ko call karo", "phone.call", mapOf("target" to "rahul")),
            Triple("call karna hai Rahul ko", "phone.call", mapOf("target" to "rahul")),
            Triple("Rahul ka number batao", "phone.find_contact", mapOf("name" to "rahul")),
            Triple("home pe jao", "device.global_action", mapOf("action" to "HOME")),
            Triple("wapas jao", "device.global_action", mapOf("action" to "BACK")),
            Triple("phone lock karo", "device.global_action", mapOf("action" to "LOCK_SCREEN")),
            Triple("OK button dabao", "screen.tap", mapOf("label" to "OK")),
            Triple("wifi chalu karo", "device.open_settings", mapOf("panel" to "WIFI")),
        )
        for ((text, skill, values) in expected) {
            assertEquals(skill, route(text)?.id, "\"$text\"")
            assertEquals(values, input(text), "\"$text\"")
        }
        for ((text, skill) in listOf(
            "screen padho" to "screen.read",
            "स्क्रीन पढ़ो" to "screen.read",
            "meri notifications padho" to "notifications.read_recent",
            "kal subah 6 baje alarm laga do" to "alarm.set",
            "अलार्म लगाओ सुबह 6 बजे" to "alarm.set",
            "mujhe 5 baje yaad dilana" to "personal.reminder",
            "meri location batao" to "location.current",
            "aaj ka screen time kitna hai" to "usage.screen_time",
        )) {
            assertEquals(skill, route(text)?.id, "\"$text\"")
        }
    }

    @Test
    fun `a sentence that says not to call, to call later, or asks how to call never opens the call flow`() {
        for (text in listOf(
            "call mat karo",
            "Rahul ko call mat karo",
            "mujhe call mat karna",
            "don't call Rahul",
            "never call this number",
            "baad mein call karna",
            "Rahul ko baad mein call karna",
            "call Rahul later",
            "call kaise karte hain",
            "call kyun nahi lag raha",
            "मम्मी को कॉल मत करो",
            "call me later",
            "call off the meeting",
        )) {
            assertNotEquals("phone.call", route(text)?.id, "\"$text\" must not start a call")
        }
    }

    @Test
    fun `whatever a Hindi, Hinglish or English sentence is routed to, a per-action capability still asks first`() {
        val corpus = listOf(
            "mummy ko call karo", "call karna hai Rahul ko", "call 9876543210", "call Mom", "home pe jao", "wapas jao", "phone lock karo",
            "lock the screen", "OK button dabao", "tap OK", "screen padho", "स्क्रीन पढ़ो", "read my screen", "meri notifications padho",
            "read my notifications", "aaj ka screen time kitna hai", "what's my screen time today", "go home", "tap Apps",
        )
        for (text in corpus) {
            val skill = route(text)
            assertTrue(skill != null, "\"$text\" should reach an on-device skill")
            val capability = capabilities.find(skill!!.capabilityId)
            if (capability?.confirmation == ConfirmationPolicy.PER_ACTION) {
                assertTrue(ActionPolicy.requiresConfirmation(skill), "\"$text\" → ${skill.id} must ask before it acts")
            }
        }
        // The actions that reach outside ZARVIS or drive another app always ask, whatever the registry says.
        for (id in listOf("phone.call", "screen.tap", "device.global_action", "screen.read")) {
            assertTrue(ActionPolicy.requiresConfirmation(registry.find(id)!!), "$id must ask before it acts")
        }
    }
}
