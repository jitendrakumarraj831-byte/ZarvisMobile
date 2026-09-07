package com.zarvismobile.domain.skill

import com.zarvismobile.domain.FakeContactLookupPort
import com.zarvismobile.domain.FakePhoneCallPort
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
    fun `is registered as MEDIUM risk, so the Tool pipeline blocks on confirmation before it ever runs`() {
        val skill = PhoneCallSkillFactory.create(FakeContactLookupPort(), FakePhoneCallPort())
        assertEquals(RiskLevel.MEDIUM, skill.riskLevel)
        assertTrue(skill.requiresConfirmation)
    }

    @Test
    fun `calling a raw phone number never touches the contacts lookup`() = runTest {
        val contacts = FakeContactLookupPort(listOf(PhoneContact("Mom", "9000000001")))
        val caller = FakePhoneCallPort()
        val skill = PhoneCallSkillFactory.create(contacts, caller)
        val result = skill.handler.execute(SkillInput(mapOf("target" to "9876543210")), context)
        val success = assertIs<SkillResult.Success>(result)
        assertEquals("Calling 9876543210.", success.summary)
        assertEquals(listOf("9876543210"), caller.calledNumbers)
    }

    @Test
    fun `calling by name resolves through the contacts port first`() = runTest {
        val caller = FakePhoneCallPort()
        val skill = PhoneCallSkillFactory.create(FakeContactLookupPort(listOf(PhoneContact("Mom", "9000000001"))), caller)
        val result = skill.handler.execute(SkillInput(mapOf("target" to "mom")), context)
        val success = assertIs<SkillResult.Success>(result)
        assertEquals("Calling Mom.", success.summary)
        assertEquals(listOf("9000000001"), caller.calledNumbers)
    }

    @Test
    fun `an unresolvable name fails without ever placing a call`() = runTest {
        val caller = FakePhoneCallPort()
        val skill = PhoneCallSkillFactory.create(FakeContactLookupPort(), caller)
        val result = skill.handler.execute(SkillInput(mapOf("target" to "Nobody")), context)
        val failure = assertIs<SkillResult.Failure>(result)
        assertEquals("contact_not_found", failure.reason)
        assertTrue(caller.calledNumbers.isEmpty())
    }

    @Test
    fun `a platform call failure is surfaced honestly, not reported as success`() = runTest {
        val skill = PhoneCallSkillFactory.create(FakeContactLookupPort(), FakePhoneCallPort(succeeds = false))
        val result = skill.handler.execute(SkillInput(mapOf("target" to "9876543210")), context)
        val failure = assertIs<SkillResult.Failure>(result)
        assertEquals("call_failed", failure.reason)
    }

    @Test
    fun `a missing target is rejected before resolving anything`() = runTest {
        val skill = PhoneCallSkillFactory.create(FakeContactLookupPort(), FakePhoneCallPort())
        val result = skill.handler.execute(SkillInput(emptyMap()), context)
        val failure = assertIs<SkillResult.Failure>(result)
        assertEquals("missing_target", failure.reason)
    }
}
