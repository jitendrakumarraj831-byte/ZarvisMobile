package com.zarvismobile.domain.port

import com.zarvismobile.domain.entity.AccountEntitlementSnapshot
import com.zarvismobile.domain.entity.ConfirmationRequest
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.entity.UsageCost
import java.time.Instant

/**
 * Seams the pure [com.zarvismobile.domain] layer is built against instead of talking to any
 * platform API directly. Android implements these with real `ContextCompat`/Compose dialogs/
 * Retrofit calls; the backend implements the equivalent shapes server-side. See
 * ARCHITECTURE.md "Why a pure-Kotlin domain module".
 */
fun interface PermissionPort {
    suspend fun isGranted(permission: PermissionType): Boolean
}

fun interface EntitlementPort {
    suspend fun snapshot(accountId: String): AccountEntitlementSnapshot
}

fun interface UsagePort {
    /** Deducts [cost] for [skillId] and returns the account's new credit balance. */
    suspend fun charge(accountId: String, cost: UsageCost, skillId: String): Int
}

fun interface ConfirmationPort {
    suspend fun confirm(request: ConfirmationRequest): Boolean
}

fun interface ClockPort {
    fun now(): Instant
}

/** Default, real-clock implementation — swapped for a fixed clock in tests. */
object SystemClockPort : ClockPort {
    override fun now(): Instant = Instant.now()
}
