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
