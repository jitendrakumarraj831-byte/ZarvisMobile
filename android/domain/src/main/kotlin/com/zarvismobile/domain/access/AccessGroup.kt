package com.zarvismobile.domain.access

/**
 * The groups of Settings › Permissions & Device Access, in the order they are shown: what Android reports allowed, what is not on
 * yet (and can be), what needs no permission at all, and what this phone or this build cannot provide.
 */
enum class AccessGroup(val label: String) {
    ALLOWED("Allowed"),
    NOT_ON("Not on yet"),
    NO_PERMISSION("No permission held"),
    UNAVAILABLE("Not available here"),
    ;

    companion object {
        /** The group for a capability from its live Android [states]; one Android cannot provide is never offered as "Not on yet". */
        fun of(implementedOnAndroid: Boolean, states: Collection<AccessState>): AccessGroup = when {
            !implementedOnAndroid || AccessState.UNAVAILABLE in states -> UNAVAILABLE
            states.isEmpty() -> NO_PERMISSION
            states.all { it.satisfied() } -> ALLOWED
            else -> NOT_ON
        }
    }
}
