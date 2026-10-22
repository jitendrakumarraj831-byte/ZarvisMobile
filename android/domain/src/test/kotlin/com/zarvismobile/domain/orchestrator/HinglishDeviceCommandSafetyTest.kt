package com.zarvismobile.domain.orchestrator

import com.zarvismobile.domain.capability.ActionPolicy
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.capability.ConfirmationPolicy
import com.zarvismobile.domain.skill.AppSearchSkillFactory
import com.zarvismobile.domain.skill.DeviceCapabilitySkills
import com.zarvismobile.domain.skill.MessageDraftSkillFactory
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
 * Pinned here: the commands that already work, Hindi word order and Devanagari ("WhatsApp kholo", "मम्मी को कॉल करो") reaching the
 * phone's own skill instead of the Brain, that a sentence which says NOT to open or call (or asks how to) never acts, and that whatever
 * a sentence is routed to, an action the registry marks per-action still asks first. Anything else goes to the Brain, which may hand a
 * phone action back to the app (ZARVIS_ASSISTANT_UPGRADE_PLAN.md Phase 6).
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
        register(MessageDraftSkillFactory.create(stub(), stub()))
        register(AppSearchSkillFactory.create(stub()))
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
    fun `Hindi word order and Devanagari open apps, settings and calls on the phone`() {
        val expected = listOf(
            "WhatsApp kholo" to ("phone.open_app" to mapOf("appName" to "whatsapp")),
            "whatsapp open karo" to ("phone.open_app" to mapOf("appName" to "whatsapp")),
            "mera whatsapp jaldi se kholo" to ("phone.open_app" to mapOf("appName" to "whatsapp")),
            "YouTube chalu karo" to ("phone.open_app" to mapOf("appName" to "youtube")),
            "chrome kholo na" to ("phone.open_app" to mapOf("appName" to "chrome")),
            "व्हाट्सएप खोलो" to ("phone.open_app" to mapOf("appName" to "व्हाट्सएप")),
            "gallery kholo" to ("phone.open_app" to mapOf("appName" to "gallery")),
            "गैलरी खोलो" to ("phone.open_app" to mapOf("appName" to "गैलरी")),
            "घड़ी खोलो" to ("phone.open_app" to mapOf("appName" to "घड़ी")),
            "open the gallery" to ("phone.open_app" to mapOf("appName" to "gallery")),
            "camera kholo" to ("phone.open_app" to mapOf("appName" to "camera")),
            "open camera" to ("phone.open_app" to mapOf("appName" to "camera")),
            "contacts kholo" to ("phone.open_app" to mapOf("appName" to "contacts")),
            "settings kholo" to ("device.open_settings" to mapOf("panel" to "MAIN")),
            "open settings" to ("device.open_settings" to mapOf("panel" to "MAIN")),
            "सेटिंग्स खोलो" to ("device.open_settings" to mapOf("panel" to "MAIN")),
            "wifi on karo" to ("device.open_settings" to mapOf("panel" to "WIFI")),
            "location chalu karo" to ("device.open_settings" to mapOf("panel" to "LOCATION")),
            "लोकेशन चालू करो" to ("device.open_settings" to mapOf("panel" to "LOCATION")),
            "मम्मी को कॉल करो" to ("phone.call" to mapOf("target" to "mummy")),
            "पापा को फोन लगाओ" to ("phone.call" to mapOf("target" to "papa")),
            "mummy ko phone lagao" to ("phone.call" to mapOf("target" to "mummy")),
            "Neha Test ko call karo" to ("phone.call" to mapOf("target" to "neha test")),
            "Rahul ko call kar de" to ("phone.call" to mapOf("target" to "rahul")),
            "Rahul ko call karo na" to ("phone.call" to mapOf("target" to "rahul")),
        )
        for ((text, routed) in expected) {
            val (skill, values) = routed
            assertEquals(skill, route(text)?.id, "\"$text\"")
            assertEquals(values, input(text), "\"$text\"")
        }
        for ((text, skill) in listOf(
            "notification mat bolo" to "notifications.speak_off",
            "meri location batao" to "location.current",
            "open bluetooth settings" to "bluetooth.open_settings",
            "take a photo" to "camera.capture_photo",
            "please remind me to call mom" to "personal.reminder",
            "open quick settings" to "device.global_action",
        )) {
            assertEquals(skill, route(text)?.id, "\"$text\"")
        }
    }

    @Test
    fun `a search in a named app opens that app's results, in Hinglish, English or Devanagari`() {
        val expected = listOf(
            "YouTube pe arijit ke gaane search karo" to mapOf("query" to "arijit ke gaane", "app" to "YouTube"),
            "youtube pe arijit ke gaane chalao" to mapOf("query" to "arijit ke gaane", "app" to "YouTube"),
            "youtube kholo aur arijit search karo" to mapOf("query" to "arijit", "app" to "YouTube"),
            "यूट्यूब पर भजन सर्च करो" to mapOf("query" to "भजन", "app" to "YouTube"),
            "search pizza on the map" to mapOf("query" to "pizza", "app" to "Maps"),
            "मैप में दिल्ली दिखाओ" to mapOf("query" to "दिल्ली", "app" to "Maps"),
            "airport ka rasta dikhao" to mapOf("query" to "airport", "app" to "Directions"),
            "navigate to connaught place" to mapOf("query" to "connaught place", "app" to "Directions"),
            "google pe best laptop search karo" to mapOf("query" to "best laptop", "app" to "Web"),
            "play store pe whatsapp search karo" to mapOf("query" to "whatsapp", "app" to "Play Store"),
        )
        for ((text, values) in expected) {
            assertEquals("app.search", route(text)?.id, "\"$text\"")
            assertEquals(values, input(text), "\"$text\"")
        }
        // An app is still just opened when nothing is searched for.
        assertEquals("phone.open_app", route("youtube kholo")?.id)
        assertEquals(mapOf("appName" to "google maps"), input("google maps kholo"))
        // Without an app named, a question, or a "don't": the Brain answers (and may still open results itself).
        for (text in listOf(
            "search for the best laptop",
            "what is youtube",
            "how to search on youtube",
            "youtube pe search mat karo",
            "I watched a video on youtube yesterday",
            "rasta batao",
        )) {
            assertEquals(null, route(text)?.id, "\"$text\" must go to the Brain")
        }
    }

    @Test
    fun `a message is never drafted from keywords, only when the Brain hands it over`() {
        for (text in listOf("draft a message to mom", "Rahul ko message bhejo ki main late hoon", "send hi to Rahul on WhatsApp")) {
            assertTrue(route(text)?.id != "message.draft", "\"$text\"")
        }
        // The emulator's Brain requests (AppAutomationTest) must reach the Brain, not a phone skill by keyword.
        for (text in listOf("send hi to 5551234", "show me the clock app and then show me the settings", "show me my gallery")) {
            assertEquals(null, route(text)?.id, "\"$text\"")
        }
    }

    @Test
    fun `a sentence that says not to open something, or asks about opening, opens nothing`() {
        for (text in listOf(
            "whatsapp mat kholo",
            "whatsapp na kholo",
            "how to open whatsapp",
            "kya tum whatsapp khol sakte ho",
            "dukaan kab kholo",
            "the shop is open",
            "is the gallery open",
            "I want to know if the shop is open today",
            "change my privacy settings in facebook",
            "Write a short product description",
        )) {
            assertEquals(null, route(text)?.id, "\"$text\" must go to the Brain")
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
            "call na karo Rahul",
            "Rahul ko call na karo",
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
            "WhatsApp kholo", "मम्मी को कॉल करो", "mummy ko phone lagao", "settings kholo", "gallery kholo",
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
