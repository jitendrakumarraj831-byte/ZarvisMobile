package com.zarvismobile.domain.orchestrator

import com.zarvismobile.domain.entity.EntitlementLevel
import com.zarvismobile.domain.entity.RiskLevel
import com.zarvismobile.domain.entity.SkillCategory
import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.SkillHandler
import com.zarvismobile.domain.entity.SkillResult
import com.zarvismobile.domain.tooling.SkillRegistry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class KeywordSkillMatcherTest {

    private fun skill(id: String, name: String, capabilities: List<String>) = SkillDefinition(
        id = id,
        name = name,
        description = "test",
        category = SkillCategory.PERSONAL,
        capabilities = capabilities,
        requiredEntitlement = EntitlementLevel.FREE,
        riskLevel = RiskLevel.LOW,
        requiresConfirmation = false,
        handler = SkillHandler { _, _ -> SkillResult.Success(emptyMap(), "ok") },
    )

    private val registry = SkillRegistry().apply {
        register(skill("personal.reminder", "Reminder", listOf("remind", "reminder", "yaad dila")))
        register(skill("web.search", "Web Search", listOf("search", "find", "compare")))
    }

    @Test
    fun `matches an English utterance to the right skill by capability keyword`() {
        val matcher = KeywordSkillMatcher(registry)
        val match = matcher.match("please remind me to call mom tomorrow")
        assertEquals("personal.reminder", match?.id)
    }

    @Test
    fun `matches a Hinglish utterance via a transliterated capability keyword`() {
        val matcher = KeywordSkillMatcher(registry)
        val match = matcher.match("kal subah yaad dila dena")
        assertEquals("personal.reminder", match?.id)
    }

    @Test
    fun `prefers the skill with more keyword hits`() {
        val matcher = KeywordSkillMatcher(registry)
        val match = matcher.match("search and compare the best phone, find me results")
        assertEquals("web.search", match?.id)
    }

    @Test
    fun `returns null when nothing in the catalogue matches`() {
        val matcher = KeywordSkillMatcher(registry)
        assertNull(matcher.match("gibberish with no relevant keywords at all"))
    }
}
