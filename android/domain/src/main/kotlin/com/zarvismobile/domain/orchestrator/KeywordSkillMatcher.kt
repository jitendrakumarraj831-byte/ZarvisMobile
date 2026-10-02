package com.zarvismobile.domain.orchestrator

import com.zarvismobile.domain.entity.SkillDefinition
import com.zarvismobile.domain.tooling.SkillRegistry

/**
 * A local, offline fallback planner — NOT the product's primary understanding/planning path.
 *
 * The real Orchestrator sends the user's utterance plus the entitlement-filtered skill
 * catalogue to an [com.zarvismobile.domain] consumer's AI provider (see AI_ARCHITECTURE.md)
 * and lets the model choose the tool call. This keyword matcher exists so that a LOW-risk,
 * on-device skill (e.g. `personal.reminder`) can still be resolved when the device is
 * offline or before a network round-trip completes, and so the planning *shape* — given a
 * catalogue and an utterance, produce a skill selection — is provable in a pure-Kotlin unit
 * test without any AI dependency.
 */
class KeywordSkillMatcher(private val registry: SkillRegistry) {

    fun match(utterance: String): SkillDefinition? = rank(utterance).firstOrNull()

    /** Every skill with a positive score, best first (stable for equal scores). */
    fun rank(utterance: String): List<SkillDefinition> {
        val normalized = utterance.lowercase()
        return registry.all()
            .map { skill -> skill to score(normalized, skill) }
            .filter { (_, score) -> score > 0 }
            .sortedByDescending { (_, score) -> score }
            .map { it.first }
    }

    /** The best-scoring skill that [DeviceCommandGate] accepts for this utterance, if any. */
    fun matchCommand(utterance: String): SkillDefinition? =
        rank(utterance).firstOrNull { DeviceCommandGate.accepts(it.id, utterance) }

    private fun score(utterance: String, skill: SkillDefinition): Int {
        val capabilityHits = skill.capabilities.count { capability -> utterance.contains(capability.lowercase()) }
        // The skill's name counts only when every significant word of it is in the utterance as
        // a whole word. Matching ANY name word as a substring made "Pick a document", "Pick a
        // photo" and "Take a photo" match almost every sentence (via "a"), and those skills'
        // gates accept any non-question: "Write a short product description" opened the
        // document picker instead of reaching the Brain.
        val nameWords = skill.name.lowercase().split(" ").filter { word -> word.length >= MIN_NAME_WORD }
        val nameHit = nameWords.isNotEmpty() && nameWords.all { word -> containsWord(utterance, word) }
        return capabilityHits * 2 + if (nameHit) 1 else 0
    }

    private fun containsWord(text: String, word: String): Boolean =
        Regex("(?<![\\p{L}\\p{M}\\p{N}])" + Regex.escape(word) + "(?![\\p{L}\\p{M}\\p{N}])").containsMatchIn(text)

    private companion object {
        /** Shorter name words ("a", "my", "on") carry no meaning for routing. */
        const val MIN_NAME_WORD = 3
    }
}
