package com.zarvismobile.domain.orchestrator

import com.zarvismobile.domain.FakeAppLauncherPort
import com.zarvismobile.domain.FakeContactLookupPort
import com.zarvismobile.domain.FakePhoneCallPort
import com.zarvismobile.domain.FixedClockPort
import com.zarvismobile.domain.InMemoryReminderScheduler
import com.zarvismobile.domain.skill.PhoneCallSkillFactory
import com.zarvismobile.domain.skill.PhoneFindContactSkillFactory
import com.zarvismobile.domain.skill.PhoneOpenAppSkillFactory
import com.zarvismobile.domain.skill.ReminderSkillFactory
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Guards the exact bug this builder exists to fix: before it, `AndroidOrchestrator` built
 * one hardcoded `{action, title}` input for every on-device match regardless of which skill
 * actually matched — correct by coincidence when `personal.reminder` was the only on-device
 * skill, silently wrong for any other one. These assertions check each skill gets the input
 * shape its own `inputSchema` actually declares.
 */
class OnDeviceInputBuilderTest {

    private val reminderSkill = ReminderSkillFactory.create(InMemoryReminderScheduler(), FixedClockPort(Instant.EPOCH))
    private val openAppSkill = PhoneOpenAppSkillFactory.create(FakeAppLauncherPort())
    private val findContactSkill = PhoneFindContactSkillFactory.create(FakeContactLookupPort())
    private val callSkill = PhoneCallSkillFactory.create(FakeContactLookupPort(), FakePhoneCallPort())

    @Test
    fun `reminder keeps the whole utterance as the title, unchanged from before this builder existed`() {
        val input = OnDeviceInputBuilder.build(reminderSkill, "remind me to call mom tomorrow")
        assertEquals("create", input.values["action"])
        assertEquals("remind me to call mom tomorrow", input.values["title"])
    }

    @Test
    fun `reminder keeps the user's own words apart from the title, for a Brain handoff whose title replaces it`() {
        val said = "kal subah 8 baje mummy ko call karne ka reminder set kar do"
        val input = OnDeviceInputBuilder.build(reminderSkill, said)
        assertEquals(said, input.values["utterance"])
        // Listing needs no words: only the action.
        assertEquals(mapOf("action" to "list"), OnDeviceInputBuilder.build(reminderSkill, "show my reminders").values)
    }

    @Test
    fun `open_app strips the trigger word, leaving the app name`() {
        val input = OnDeviceInputBuilder.build(openAppSkill, "open WhatsApp")
        assertEquals("whatsapp", input.values["appName"])
    }

    @Test
    fun `find_contact strips trigger words and a trailing possessive`() {
        val input = OnDeviceInputBuilder.build(findContactSkill, "find Mom's number")
        assertEquals("mom", input.values["name"])
    }

    @Test
    fun `call strips the trigger word, leaving a contact name`() {
        val input = OnDeviceInputBuilder.build(callSkill, "call Mom")
        assertEquals("mom", input.values["target"])
    }

    private fun nameFor(text: String) = OnDeviceInputBuilder.build(findContactSkill, text).values["name"]
    private fun targetFor(text: String) = OnDeviceInputBuilder.build(callSkill, text).values["target"]

    /** Each of these used to leave extra words in the name ("what is mom", "mom batao", "mom phone"), so the lookup found nobody. */
    @Test
    fun `find_contact leaves only the person's name however the request is phrased`() {
        val cases = mapOf(
            "find mom's phone number" to "mom",
            "mom ka phone number batao" to "mom",
            "what is mom's number" to "mom",
            "what's mom's number" to "mom",
            "mom ka number batao" to "mom",
            "Priya ka number dikhao" to "priya",
            "Rahul ka contact dhundo" to "rahul",
            "contact dhundo Rahul" to "rahul",
            "show me Priya's number" to "priya",
            "get mom's number" to "mom",
            "give me Amit's number" to "amit",
            "tell me dad's number" to "dad",
            "number of mom" to "mom",
            "find contact for John" to "john",
            "find Rahul Sharma's number" to "rahul sharma",
        )
        for ((text, expected) in cases) assertEquals(expected, nameFor(text), "name for \"$text\"")
    }

    @Test
    fun `apostrophes are dropped when they only mark a possessive, and kept inside a name`() {
        assertEquals("dennis", nameFor("find Dennis' number"))
        assertEquals("o'brien", nameFor("find O'Brien's number"))
        assertEquals("mom", nameFor("find Mom\u2019s number"))
    }

    @Test
    fun `call leaves only who to call, without politeness, timing or speaker words`() {
        val cases = mapOf(
            "Call Mom please" to "mom",
            "Call Mom, please!" to "mom",
            "call mom." to "mom",
            "call mom's mobile" to "mom",
            "call dad's phone" to "dad",
            "call Rahul on speaker" to "rahul",
            "call Mom now" to "mom",
            "papa ko call lagao" to "papa",
            "mom ko call karo" to "mom",
            "call kar mom ko" to "mom",
            "call my brother" to "brother",
            "call the doctor" to "doctor",
            "dial mom" to "mom",
            "call Rahul Sharma" to "rahul sharma",
            "call Dr. Priya Singh" to "dr. priya singh",
            "call 112" to "112",
            "call +91 98765 43210" to "+91 98765 43210",
        )
        for ((text, expected) in cases) assertEquals(expected, targetFor(text), "target for \"$text\"")
    }

    @Test
    fun `a name that contains one of the removed words is not lost`() {
        // "De" and "Mobile" are words in real contact names; "mobile" alone must not leave an empty name.
        assertEquals("de silva", targetFor("call De Silva"))
        assertEquals("mobile", targetFor("call mobile"))
    }

    @Test
    fun `open_app keeps the words of an app name that the contact skills would drop`() {
        assertEquals("clash of clans", OnDeviceInputBuilder.build(openAppSkill, "open Clash of Clans").values["appName"])
        assertEquals("whatsapp", OnDeviceInputBuilder.build(openAppSkill, "Open WhatsApp!").values["appName"])
    }

    @Test
    fun `call strips the trigger word, leaving a raw phone number`() {
        val input = OnDeviceInputBuilder.build(callSkill, "call 9876543210")
        assertEquals("9876543210", input.values["target"])
    }
}
