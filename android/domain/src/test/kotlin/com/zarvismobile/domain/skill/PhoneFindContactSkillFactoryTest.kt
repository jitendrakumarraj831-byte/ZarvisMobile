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
    fun `is a MEDIUM risk read-only lookup gated by the CONTACTS permission, no per-lookup confirmation`() {
        val skill = PhoneFindContactSkillFactory.create(FakeContactLookupPort())
        assertEquals(RiskLevel.MEDIUM, skill.riskLevel)
        assertEquals("contacts", skill.capabilityId)
        assertTrue(!com.zarvismobile.domain.capability.ActionPolicy.requiresConfirmation(skill))
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
    fun `the best match wins over names that only contain the text`() = runTest {
        val contacts = FakeContactLookupPort(listOf(PhoneContact("Sriram", "1111111111"), PhoneContact("Ram", "2222222222")))
        val success = assertIs<SkillResult.Success>(
            PhoneFindContactSkillFactory.create(contacts).handler.execute(SkillInput(mapOf("name" to "ram")), context),
        )
        assertEquals("Ram: 2222222222", success.summary)
        assertEquals("Ram", success.output["name"])
    }

    @Test
    fun `a name that fits several people lists them all instead of picking one`() = runTest {
        val contacts = FakeContactLookupPort(
            listOf(PhoneContact("Ram Singh", "2222222222"), PhoneContact("Ram Kumar", "1111111111"), PhoneContact("Priya", "3333333333")),
        )
        val success = assertIs<SkillResult.Success>(
            PhoneFindContactSkillFactory.create(contacts).handler.execute(SkillInput(mapOf("name" to "ram")), context),
        )
        assertEquals("2 contacts match \"ram\": Ram Kumar: 1111111111; Ram Singh: 2222222222", success.summary)
        assertEquals(2, success.output["count"])
    }

    @Test
    fun `a long list of matches is cut to five and says how many more there are`() = runTest {
        val contacts = FakeContactLookupPort((1..8).map { PhoneContact("Ram $it", "900000000$it") })
        val success = assertIs<SkillResult.Success>(
            PhoneFindContactSkillFactory.create(contacts).handler.execute(SkillInput(mapOf("name" to "ram")), context),
        )
        assertTrue(success.summary.startsWith("8 contacts match"))
        assertTrue(success.summary.endsWith("(and 3 more)"), success.summary)
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
