package com.jarvismobile.domain.tooling

import com.jarvismobile.domain.entity.SkillCategory
import com.jarvismobile.domain.entity.SkillDefinition

/**
 * In-memory catalogue of every registered skill. Populated at app/backend startup by each
 * skill package (see SKILLS.md "Authoring a new skill"). Drives both the LLM tool-calling
 * definitions (AI_ARCHITECTURE.md) and the live "What can you do?" screen — never hand-authored
 * per screen.
 */
class SkillRegistry {
    private val skills = mutableMapOf<String, SkillDefinition>()

    fun register(skill: SkillDefinition) {
        require(skill.id !in skills) { "Duplicate skill id: '${skill.id}' is already registered" }
        skills[skill.id] = skill
    }

    fun find(id: String): SkillDefinition? = skills[id]

    fun all(): List<SkillDefinition> = skills.values.toList()

    fun byCategory(category: SkillCategory): List<SkillDefinition> =
        skills.values.filter { it.category == category }
}
