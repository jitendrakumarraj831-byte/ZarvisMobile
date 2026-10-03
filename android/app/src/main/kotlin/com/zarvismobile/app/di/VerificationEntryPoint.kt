package com.zarvismobile.app.di

import com.zarvismobile.agents.AndroidOrchestrator
import com.zarvismobile.app.access.NotificationSpeaker
import com.zarvismobile.core.security.SpecialAccessStates
import com.zarvismobile.core.tooling.ComposeConfirmationPort
import com.zarvismobile.core.tooling.ComposeRationalePort
import com.zarvismobile.domain.access.AccessCoordinator
import com.zarvismobile.domain.access.DeviceAccessPort
import com.zarvismobile.domain.access.PendingActionStore
import com.zarvismobile.domain.access.RevocationDetector
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.skill.NotificationReaderPort
import com.zarvismobile.domain.skill.NotificationSettingsPort
import com.zarvismobile.domain.skill.ScreenAccessPort
import com.zarvismobile.domain.skill.UsageStatsPort
import com.zarvismobile.domain.tooling.ToolPipeline
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/**
 * Access to the app's real singletons for on-device verification (app/src/androidTest). It
 * exposes nothing a user couldn't also reach through the UI; it lets emulator tests drive and
 * assert the real Android integrations without re-implementing the object graph.
 */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface VerificationEntryPoint {
    fun capabilityRegistry(): CapabilityRegistry
    fun deviceAccessPort(): DeviceAccessPort
    fun accessCoordinator(): AccessCoordinator
    fun rationalePort(): ComposeRationalePort
    fun confirmationPort(): ComposeConfirmationPort
    fun revocationDetector(): RevocationDetector
    fun pendingActionStore(): PendingActionStore
    fun specialAccessStates(): SpecialAccessStates
    fun notificationReader(): NotificationReaderPort
    fun notificationSettings(): NotificationSettingsPort
    fun notificationSpeaker(): NotificationSpeaker
    fun screenAccess(): ScreenAccessPort
    fun usageStats(): UsageStatsPort
    fun toolPipeline(): ToolPipeline
    fun orchestrator(): AndroidOrchestrator
}
