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

    @Test
    fun `call strips the trigger word, leaving a raw phone number`() {
        val input = OnDeviceInputBuilder.build(callSkill, "call 9876543210")
        assertEquals("9876543210", input.values["target"])
    }
}
