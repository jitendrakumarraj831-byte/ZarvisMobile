package com.jarvismobile.domain

import com.jarvismobile.domain.entity.AccountEntitlementSnapshot
import com.jarvismobile.domain.entity.ConfirmationRequest
import com.jarvismobile.domain.entity.PermissionType
import com.jarvismobile.domain.entity.Reminder
import com.jarvismobile.domain.entity.UsageCost
import com.jarvismobile.domain.port.ClockPort
import com.jarvismobile.domain.port.ConfirmationPort
import com.jarvismobile.domain.port.EntitlementPort
import com.jarvismobile.domain.port.PermissionPort
import com.jarvismobile.domain.port.UsagePort
import com.jarvismobile.domain.skill.ReminderSchedulerPort
import java.time.Instant

class FakePermissionPort(private val granted: Set<PermissionType> = emptySet()) : PermissionPort {
    override suspend fun isGranted(permission: PermissionType): Boolean = permission in granted
}

class FakeEntitlementPort(private val snapshot: AccountEntitlementSnapshot) : EntitlementPort {
    override suspend fun snapshot(accountId: String): AccountEntitlementSnapshot = snapshot
}

class FakeUsagePort(initialBalance: Int = 0) : UsagePort {
    var balance: Int = initialBalance
        private set
    val charges = mutableListOf<Pair<String, UsageCost>>()

    override suspend fun charge(accountId: String, cost: UsageCost, skillId: String): Int {
        balance -= cost.value
        charges += skillId to cost
        return balance
    }
}

class FakeConfirmationPort(private val approve: Boolean) : ConfirmationPort {
    var lastRequest: ConfirmationRequest? = null
        private set

    override suspend fun confirm(request: ConfirmationRequest): Boolean {
        lastRequest = request
        return approve
    }
}

class FixedClockPort(private val instant: Instant) : ClockPort {
    override fun now(): Instant = instant
}

class InMemoryReminderScheduler : ReminderSchedulerPort {
    private val reminders = mutableMapOf<String, Reminder>()

    override suspend fun schedule(reminder: Reminder): Reminder {
        reminders[reminder.id] = reminder
        return reminder
    }

    override suspend fun list(): List<Reminder> = reminders.values.toList()

    override suspend fun complete(id: String): Boolean {
        val existing = reminders[id] ?: return false
        reminders[id] = existing.copy(completed = true)
        return true
    }
}
