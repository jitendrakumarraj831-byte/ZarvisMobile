package com.zarvismobile.domain

import com.zarvismobile.domain.entity.AccountEntitlementSnapshot
import com.zarvismobile.domain.entity.ConfirmationRequest
import com.zarvismobile.domain.entity.PermissionType
import com.zarvismobile.domain.entity.Reminder
import com.zarvismobile.domain.entity.UsageCost
import com.zarvismobile.domain.port.ClockPort
import com.zarvismobile.domain.port.ConfirmationPort
import com.zarvismobile.domain.port.EntitlementPort
import com.zarvismobile.domain.port.PermissionPort
import com.zarvismobile.domain.port.UsagePort
import com.zarvismobile.domain.skill.AppLaunchResult
import com.zarvismobile.domain.skill.AppLauncherPort
import com.zarvismobile.domain.skill.ContactLookupPort
import com.zarvismobile.domain.skill.PhoneCallPort
import com.zarvismobile.domain.skill.PhoneContact
import com.zarvismobile.domain.skill.ReminderSchedulerPort
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

class FakeContactLookupPort(private val contacts: List<PhoneContact> = emptyList()) : ContactLookupPort {
    override suspend fun findByName(name: String): PhoneContact? =
        contacts.firstOrNull { it.displayName.contains(name, ignoreCase = true) }
}

class FakeAppLauncherPort(private val installedApps: Set<String> = emptySet()) : AppLauncherPort {
    val launched = mutableListOf<String>()

    override suspend fun openApp(appName: String): AppLaunchResult {
        val match = installedApps.firstOrNull { it.contains(appName, ignoreCase = true) } ?: return AppLaunchResult.NotFound
        launched += match
        return AppLaunchResult.Opened(match)
    }
}

class FakePhoneCallPort(private val succeeds: Boolean = true) : PhoneCallPort {
    val calledNumbers = mutableListOf<String>()

    override suspend fun call(phoneNumber: String): Boolean {
        calledNumbers += phoneNumber
        return succeeds
    }
}
