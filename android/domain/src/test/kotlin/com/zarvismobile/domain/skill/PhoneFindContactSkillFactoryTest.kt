package com.zarvismobile.domain.skill

import com.zarvismobile.domain.FakeContactLookupPort
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.entity.RiskLevel
import com.zarvismobile.domain.entity.SkillExecutionContext
import com.zarvismobile.domain.entity.SkillInput
import com.zarvismobile.domain.entity.SkillResult
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class PhoneFindContactSkillFactoryTest {

    private val context = SkillExecutionContext(accountId = "acc-1")

    @Test
    fun `is registered as MEDIUM risk requiring CONTACTS, per the SKILLS-md rubric`() {
        val skill = PhoneFindContactSkillFactory.create(FakeContactLookupPort())
        assertEquals(RiskLevel.MEDIUM, skill.riskLevel)
        assertTrue(skill.requiresConfirmation)
        assertEquals(listOf(PermissionType.CONTACTS), skill.requiredPermissions)
    }

    @Test
    fun `finds a contact by partial, case-insensitive name`() = runTest {
        val contacts = FakeContactLookupPort(listOf(PhoneContact("Mom", "+91 90000 00001")))
        val skill = PhoneFindContactSkillFactory.create(contacts)
        val result = skill.handler.execute(SkillInput(mapOf("name" to "mom")), context)
        val success = assertIs<SkillResult.Success>(result)
        assertEquals("Mom: +91 90000 00001", success.summary)
    }

    @Test
    fun `an unknown contact fails with a clear reason, not a crash`() = runTest {
        val skill = PhoneFindContactSkillFactory.create(FakeContactLookupPort())
        val result = skill.handler.execute(SkillInput(mapOf("name" to "Nobody")), context)
        val failure = assertIs<SkillResult.Failure>(result)
        assertEquals("contact_not_found", failure.reason)
    }

    @Test
    fun `a missing name is rejected before touching the contacts port`() = runTest {
        val skill = PhoneFindContactSkillFactory.create(FakeContactLookupPort())
        val result = skill.handler.execute(SkillInput(emptyMap()), context)
        val failure = assertIs<SkillResult.Failure>(result)
        assertEquals("missing_name", failure.reason)
    }
}
