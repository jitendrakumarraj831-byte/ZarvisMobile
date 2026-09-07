package com.zarvismobile.domain.orchestrator

import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.entity.SkillInput

/**
 * Builds the [SkillInput] for a skill [KeywordSkillMatcher] matched, from the raw utterance
 * — for the same "offline, no AI provider" fallback path that matcher exists for (see its
 * own doc comment), NOT a real NLU/entity-extraction step. Before this existed, the
 * Android-side caller (`AndroidOrchestrator`, agents module) built one hardcoded
 * `{action, title}` shape for every match regardless of which skill actually matched — fine
 * when `personal.reminder` was the only on-device skill, silently wrong the moment a second
 * one (with a different `inputSchema`) was registered, since every match would still be fed
 * reminder-shaped input. Keyed on [SkillDefinition.id] and kept here rather than in
 * `AndroidOrchestrator` so this parsing logic is provable in a pure-Kotlin unit test
 * (`agents` is an Android library module and can't be) — see ARCHITECTURE.md "Why a
 * pure-Kotlin domain module".
 */
object OnDeviceInputBuilder {

    fun build(skill: SkillDefinition, utterance: String): SkillInput = when (skill.id) {
        "personal.reminder" -> SkillInput(mapOf("action" to "create", "title" to utterance))
        "phone.open_app" -> SkillInput(mapOf("appName" to subject(utterance, skill)))
        "phone.find_contact" -> SkillInput(mapOf("name" to subject(utterance, skill)))
        "phone.call" -> SkillInput(mapOf("target" to subject(utterance, skill)))
        else -> SkillInput(mapOf("utterance" to utterance))
    }

    /**
     * Strips the skill's own trigger words (its declared capabilities/name) and a short list
     * of common filler words from the utterance, leaving — for the simple phrasings this is
     * meant to cover ("open WhatsApp", "call Mom", "call 9876543210") — just the subject.
     * Deliberately crude, same spirit as the untouched `personal.reminder` case above (which
     * does no stripping at all): this is the offline fallback, not real understanding
     * (AI_ARCHITECTURE.md's tool-calling loop is that).
     */
    private fun subject(utterance: String, skill: SkillDefinition): String {
        var remainder = " ${utterance.lowercase()} "
        val triggerWords = skill.capabilities + skill.name.lowercase().split(" ")
        for (word in triggerWords) {
            if (word.isBlank()) continue
            remainder = remainder.replace(" ${word.lowercase()} ", " ")
        }
        for (filler in FILLER_WORDS) {
            remainder = remainder.replace(Regex("\\b$filler\\b"), " ")
        }
        return remainder.replace(Regex("'s\\b"), "").trim().split(Regex("\\s+")).filter { it.isNotBlank() }.joinToString(" ")
    }

    private val FILLER_WORDS = listOf(
        "please", "the", "to", "a", "an", "for", "me", "my", "on", "up",
        "ka", "ki", "ko", "se", "kar", "karo", "do", "kro", "zara",
    )
}
