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

    fun match(utterance: String): SkillDefinition? {
        val normalized = utterance.lowercase()
        return registry.all()
            .map { skill -> skill to score(normalized, skill) }
            .filter { (_, score) -> score > 0 }
            .maxByOrNull { (_, score) -> score }
            ?.first
    }

    private fun score(utterance: String, skill: SkillDefinition): Int {
        val capabilityHits = skill.capabilities.count { capability -> utterance.contains(capability.lowercase()) }
        val nameHit = skill.name.lowercase().split(" ").any { word -> word.isNotBlank() && utterance.contains(word) }
        return capabilityHits * 2 + if (nameHit) 1 else 0
    }
}
