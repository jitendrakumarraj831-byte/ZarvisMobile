package com.jarvismobile.data.repository

import com.jarvismobile.data.remote.JarvisApi
import com.jarvismobile.data.remote.dto.UsageChargeRequest
import com.jarvismobile.domain.entity.AccountEntitlementSnapshot
import com.jarvismobile.domain.entity.EntitlementLevel
import com.jarvismobile.domain.entity.UsageCost
import com.jarvismobile.domain.port.EntitlementPort
import com.jarvismobile.domain.port.UsagePort
import java.time.Instant

/**
 * Server-authoritative [EntitlementPort] — see ARCHITECTURE.md "Backend/Android parity
 * note". The Android [com.jarvismobile.domain.tooling.ToolPipeline] calls this before
 * running any skill, on-device or not, so plan/trial/credit truth always comes from the
 * backend rather than a value the client could tamper with.
 */
class RemoteEntitlementPort(private val api: JarvisApi) : EntitlementPort {
    override suspend fun snapshot(accountId: String): AccountEntitlementSnapshot {
        val response = api.getEntitlements()
        return AccountEntitlementSnapshot(
            accountId = response.accountId,
            plan = EntitlementLevel.valueOf(response.plan),
            trialExpiresAt = response.trialExpiresAt?.let { Instant.parse(it) },
            creditBalance = response.creditBalance,
        )
    }
}

/**
 * Reports a completed, verified on-device skill execution to the backend's credit ledger
 * (`POST /api/v1/usage/charge`) — the server looks up the real cost by skill id itself, so
 * this call cannot under-report cost. See MASTER_SPEC.md §25.
 */
class RemoteUsagePort(private val api: JarvisApi) : UsagePort {
    override suspend fun charge(accountId: String, cost: UsageCost, skillId: String): Int {
        return api.chargeUsage(UsageChargeRequest(skillId)).balance
    }
}
