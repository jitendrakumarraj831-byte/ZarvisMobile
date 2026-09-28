package com.zarvismobile.domain.entity

/** Android runtime permissions / OAuth-style scopes a skill may require. See MASTER_SPEC.md §16. */
enum class PermissionType(
    /**
     * True for access Android grants only on a dedicated system Settings page (never through a
     * runtime permission dialog): notification access, an accessibility service, usage access
     * and the assistant role.
     */
    val specialAccess: Boolean = false,
) {
    NOTIFICATIONS,
    CONTACTS,
    PHONE_CALL,
    CAMERA,
    MICROPHONE,
    STORAGE,
    CALENDAR,
    LOCATION,

    /** NotificationListenerService enabled in Settings > Notification access. */
    NOTIFICATION_LISTENER(specialAccess = true),

    /** ZARVIS's AccessibilityService turned on in Settings > Accessibility. */
    ACCESSIBILITY_SERVICE(specialAccess = true),

    /** PACKAGE_USAGE_STATS app-op allowed in Settings > Usage access. */
    USAGE_ACCESS(specialAccess = true),

    /** ZARVIS holds RoleManager.ROLE_ASSISTANT (chosen in Settings > Default apps). */
    ASSISTANT_ROLE(specialAccess = true),
}

/**
 * Blueprint §10 risk classes. The confirmation decision is made by
 * [com.zarvismobile.domain.capability.ActionPolicy] from risk + [ActionClass]; VERY_HIGH is
 * reserved for security-sensitive capabilities (accessibility, screen interaction).
 */
enum class RiskLevel { LOW, MEDIUM, HIGH, VERY_HIGH }

/** Blueprint §17 action classes. */
enum class ActionClass { READ_ONLY, LOW_IMPACT, EXTERNAL_COMMUNICATION, FINANCIAL, DESTRUCTIVE, SECURITY_SENSITIVE }

/** Blueprint §19 truthful capability status. */
enum class CapabilityStatus { WORKING, PARTIAL, PLANNED, UNSUPPORTED }

/** Blueprint §10 structured tool result statuses. */
enum class ToolResultStatus {
    COMPLETED,
    DENIED,
    PERMISSION_REQUIRED,
    USER_ACTION_REQUIRED,
    CONFIRMATION_REQUIRED,
    UNSUPPORTED,
    FAILED,
}

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
