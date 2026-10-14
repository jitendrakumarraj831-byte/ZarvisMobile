package com.zarvismobile.domain.skill

import com.zarvismobile.domain.FakeContactLookupPort
import com.zarvismobile.domain.FakePhoneCallPort
import com.zarvismobile.domain.capability.ActionPolicy
import com.zarvismobile.domain.entity.ActionClass
import com.zarvismobile.domain.entity.PreparedAction
import com.zarvismobile.domain.entity.RiskLevel
import com.zarvismobile.domain.entity.SkillExecutionContext
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.entity.SkillResult
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class PhoneCallSkillFactoryTest {

    private val context = SkillExecutionContext(accountId = "acc-1")

    @Test
    fun `is HIGH risk external communication, so the policy always requires a per-call confirmation`() {
        val skill = PhoneCallSkillFactory.create(FakeContactLookupPort(), FakePhoneCallPort())
        assertEquals(RiskLevel.HIGH, skill.riskLevel)
        assertEquals(ActionClass.EXTERNAL_COMMUNICATION, skill.actionClass)
        assertEquals("phone_call", skill.capabilityId)
        assertTrue(ActionPolicy.requiresConfirmation(skill))
    }

    @Test
    fun `prepare resolves a name to the exact number shown in the confirmation`() = runTest {
        val skill = PhoneCallSkillFactory.create(FakeContactLookupPort(listOf(PhoneContact("Mom Sharma", "+91 90000 00001"))), FakePhoneCallPort())
        val prepared = assertIs<PreparedAction.Ready>(skill.preparer!!.prepare(SkillInput(mapOf("target" to "mom")), context))
        assertEquals("Call Mom Sharma at +91 90000 00001", prepared.description)
        assertEquals("+91 90000 00001", prepared.input.values[PhoneCallSkillFactory.RESOLVED_NUMBER])
    }

    @Test
    fun `prepare for a raw number never touches the contacts lookup`() = runTest {
        val skill = PhoneCallSkillFactory.create(FakeContactLookupPort(listOf(PhoneContact("Mom", "9000000001"))), FakePhoneCallPort())
        val prepared = assertIs<PreparedAction.Ready>(skill.preparer!!.prepare(SkillInput(mapOf("target" to "98765 43210")), context))
        assertEquals("Call 9876543210", prepared.description)
    }

    @Test
    fun `a name that fits several people is refused, naming them, instead of ringing one at random`() = runTest {
        val caller = FakePhoneCallPort()
        val contacts = FakeContactLookupPort(listOf(PhoneContact("Ram Singh", "9000000002"), PhoneContact("Ram Kumar", "9000000001")))
        val skill = PhoneCallSkillFactory.create(contacts, caller)
        val prepared = assertIs<PreparedAction.Failed>(skill.preparer!!.prepare(SkillInput(mapOf("target" to "ram")), context))
        assertEquals("ambiguous_contact", prepared.failure.reason)
        assertTrue(prepared.failure.userMessage.contains("Ram Kumar, Ram Singh"), prepared.failure.userMessage)
        assertTrue(prepared.failure.userMessage.contains("full name"))
        assertTrue(caller.calledNumbers.isEmpty())
    }

    @Test
    fun `the full name of one of several people is enough`() = runTest {
        val contacts = FakeContactLookupPort(listOf(PhoneContact("Ram Singh", "9000000002"), PhoneContact("Ram Kumar", "9000000001")))
        val skill = PhoneCallSkillFactory.create(contacts, FakePhoneCallPort())
        val prepared = assertIs<PreparedAction.Ready>(skill.preparer!!.prepare(SkillInput(mapOf("target" to "ram kumar")), context))
        assertEquals("Call Ram Kumar at 9000000001", prepared.description)
    }

    @Test
    fun `a contact named exactly like the target is chosen over longer names that contain it`() = runTest {
        val contacts = FakeContactLookupPort(listOf(PhoneContact("Sriram", "9000000003"), PhoneContact("Ram", "9000000001"), PhoneContact("Ram Singh", "9000000002")))
        val skill = PhoneCallSkillFactory.create(contacts, FakePhoneCallPort())
        val prepared = assertIs<PreparedAction.Ready>(skill.preparer!!.prepare(SkillInput(mapOf("target" to "ram")), context))
        assertEquals("Call Ram at 9000000001", prepared.description)
    }

    @Test
    fun `a short emergency or service number is dialed as a number, not searched for as a name`() = runTest {
        val contacts = FakeContactLookupPort(listOf(PhoneContact("112 Cafe", "9000000009")))
        val skill = PhoneCallSkillFactory.create(contacts, FakePhoneCallPort())
        for (number in listOf("112", "100", "1098")) {
            val prepared = assertIs<PreparedAction.Ready>(skill.preparer!!.prepare(SkillInput(mapOf("target" to number)), context))
            assertEquals("Call $number", prepared.description)
            assertEquals(number, prepared.input.values[PhoneCallSkillFactory.RESOLVED_NUMBER])
        }
    }

    @Test
    fun `only digits and dialing punctuation count as a number`() {
        assertTrue(PhoneCallSkillFactory.looksLikePhoneNumber("+91 98765-43210"))
        assertTrue(PhoneCallSkillFactory.looksLikePhoneNumber("112"))
        assertTrue(!PhoneCallSkillFactory.looksLikePhoneNumber("12"))
        assertTrue(!PhoneCallSkillFactory.looksLikePhoneNumber("1234567 office"))
        assertTrue(!PhoneCallSkillFactory.looksLikePhoneNumber("mom"))
        assertTrue(!PhoneCallSkillFactory.looksLikePhoneNumber("*123#"))
    }

    @Test
    fun `a call with no target asks who to call instead of searching for an empty name`() = runTest {
        val skill = PhoneCallSkillFactory.create(FakeContactLookupPort(listOf(PhoneContact("Mom", "9000000001"))), FakePhoneCallPort())
        val prepared = assertIs<PreparedAction.Failed>(skill.preparer!!.prepare(SkillInput(mapOf("target" to "  ")), context))
        assertEquals("missing_target", prepared.failure.reason)
    }

    @Test
    fun `an unresolvable name fails at prepare, before any confirmation or call`() = runTest {
        val caller = FakePhoneCallPort()
        val skill = PhoneCallSkillFactory.create(FakeContactLookupPort(), caller)
        val prepared = assertIs<PreparedAction.Failed>(skill.preparer!!.prepare(SkillInput(mapOf("target" to "Nobody")), context))
        assertEquals("contact_not_found", prepared.failure.reason)
        assertTrue(caller.calledNumbers.isEmpty())
    }

    @Test
    fun `the handler dials exactly the prepared number`() = runTest {
        val caller = FakePhoneCallPort()
        val skill = PhoneCallSkillFactory.create(FakeContactLookupPort(), caller)
        val input = SkillInput(mapOf("target" to "mom", PhoneCallSkillFactory.RESOLVED_NAME to "Mom", PhoneCallSkillFactory.RESOLVED_NUMBER to "9000000001"))
        val success = assertIs<SkillResult.Success>(skill.handler.execute(input, context))
        assertEquals(listOf("9000000001"), caller.calledNumbers)
        assertTrue(success.summary.contains("9000000001"))
        assertEquals("ACTION_CALL", success.evidence["dialerAcceptedIntent"])
    }

    @Test
    fun `the handler refuses an unprepared call instead of guessing a number`() = runTest {
        val caller = FakePhoneCallPort()
        val skill = PhoneCallSkillFactory.create(FakeContactLookupPort(), caller)
        val failure = assertIs<SkillResult.Failure>(skill.handler.execute(SkillInput(mapOf("target" to "9876543210")), context))
        assertEquals("not_prepared", failure.reason)
        assertTrue(caller.calledNumbers.isEmpty())
    }

    @Test
    fun `a platform call failure is surfaced honestly, not reported as success`() = runTest {
        val skill = PhoneCallSkillFactory.create(FakeContactLookupPort(), FakePhoneCallPort(succeeds = false))
        val input = SkillInput(mapOf("target" to "x", PhoneCallSkillFactory.RESOLVED_NAME to "X", PhoneCallSkillFactory.RESOLVED_NUMBER to "9876543210"))
        assertEquals("call_failed", assertIs<SkillResult.Failure>(skill.handler.execute(input, context)).reason)
    }
}
