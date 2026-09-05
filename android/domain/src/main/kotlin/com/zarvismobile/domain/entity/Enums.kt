package com.zarvismobile.domain.entity

/** Android runtime permissions / OAuth-style scopes a skill may require. See MASTER_SPEC.md §16. */
enum class PermissionType {
    NOTIFICATIONS,
    CONTACTS,
    PHONE_CALL,
    CAMERA,
    MICROPHONE,
    STORAGE,
    CALENDAR,
    LOCATION,
}

/** LOW auto-runs; MEDIUM/HIGH require explicit user confirmation. See MASTER_SPEC.md §7, §21. */
enum class RiskLevel { LOW, MEDIUM, HIGH }

/**
 * Ranked from least to most capable. Order matters: [EntitlementResolver] compares plans by
 * ordinal-equivalent rank, not by name. See MASTER_SPEC.md §19.
 */
enum class EntitlementLevel { FREE, TRIAL, PLUS, PRO, BUSINESS, ENTERPRISE }

/** Mirrors the capability categories in MASTER_SPEC.md §1 and the skills/ layout in §6. */
enum class SkillCategory {
    PERSONAL,
    PHONE,
    WEB,
    DOCUMENTS,
    PRODUCTIVITY,
    BUSINESS,
    RESEARCH,
    CREATIVE,
    EDUCATION,
    SEO,
    DEVELOPER,
    GITHUB,
    AUTOMATION,
}

/** See MASTER_SPEC.md §18 (Task Engine). */
enum class TaskStatus { PENDING, RUNNING, PAUSED, DONE, FAILED, CANCELLED }

enum class StepStatus { PENDING, RUNNING, DONE, FAILED, SKIPPED }
