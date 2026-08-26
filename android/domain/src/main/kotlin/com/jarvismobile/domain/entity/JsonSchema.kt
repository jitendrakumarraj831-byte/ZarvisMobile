package com.jarvismobile.domain.entity

/**
 * Deliberately minimal input-contract representation for a skill.
 *
 * This is not a full JSON Schema implementation — it captures exactly what the Tool
 * pipeline's validation stage needs (which fields must be present) and what an LLM
 * tool-definition needs (a human-readable type hint per field). See MASTER_SPEC.md §6/§7.
 */
data class JsonSchema(
    val requiredFields: Set<String> = emptySet(),
    val properties: Map<String, String> = emptyMap(),
)
