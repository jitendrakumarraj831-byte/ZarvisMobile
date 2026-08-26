package com.jarvismobile.domain.entity

import java.time.Instant

enum class EntitlementDenialReason { TRIAL_EXPIRED, PLAN_TOO_LOW, OUT_OF_CREDITS }

/** See MASTER_SPEC.md §19 — the single decision type every plan/price check resolves to. */
sealed interface EntitlementDecision {
    data object Allowed : EntitlementDecision
    data class Denied(val reason: EntitlementDenialReason, val upgradeTo: EntitlementLevel?) : EntitlementDecision
}

/**
 * A point-in-time read of an account's billing state, fetched server-authoritatively via
 * [com.jarvismobile.domain.port.EntitlementPort]. [com.jarvismobile.domain.entitlement.EntitlementResolver]
 * is pure given one of these, which is what keeps entitlement logic unit-testable without a
 * network call.
 */
data class AccountEntitlementSnapshot(
    val accountId: String,
    val plan: EntitlementLevel,
    val trialExpiresAt: Instant?,
    val creditBalance: Int,
)
