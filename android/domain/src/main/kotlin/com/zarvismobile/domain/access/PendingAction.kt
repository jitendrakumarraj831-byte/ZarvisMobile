package com.zarvismobile.domain.access

import java.time.Duration
import java.time.Instant

/**
 * An on-device action that was waiting on the user (permission dialog, Settings, or a
 * confirmation) when the process could be killed. Persisted so it can be offered again after
 * process death — never executed automatically.
 */
data class PendingAction(
    val id: String,
    val utterance: String,
    val skillId: String,
    val stage: Stage,
    val createdAt: Instant,
) {
    enum class Stage { AWAITING_PERMISSION, AWAITING_CONFIRMATION }
}

interface PendingActionStore {
    suspend fun save(action: PendingAction)
    suspend fun load(): PendingAction?
    suspend fun clear()
}

/** What to do with a pending action found at startup. */
sealed interface RecoveryDecision {
    data object Nothing : RecoveryDecision

    /** Ask the user whether to continue; continuing re-runs the full permission + confirmation flow. */
    data class OfferResume(val action: PendingAction) : RecoveryDecision

    /** Too old to offer — discarded, and the user is told it was not performed. */
    data class Expired(val action: PendingAction) : RecoveryDecision
}

object PendingActionRecovery {
    val MAX_AGE: Duration = Duration.ofMinutes(30)

    fun decide(action: PendingAction?, now: Instant): RecoveryDecision = when {
        action == null -> RecoveryDecision.Nothing
        Duration.between(action.createdAt, now) > MAX_AGE || action.createdAt.isAfter(now) -> RecoveryDecision.Expired(action)
        else -> RecoveryDecision.OfferResume(action)
    }
}
