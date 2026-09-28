package com.zarvismobile.app.di

import com.zarvismobile.domain.access.AccessCoordinator
import com.zarvismobile.domain.access.DeviceAccessPort
import com.zarvismobile.domain.capability.CapabilityRegistry
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/**
 * Read-only access to the app's real singletons for on-device verification
 * (app/src/androidTest). Exposes nothing a test could not also reach through the UI; it only
 * lets emulator tests assert what Android reports without re-implementing the object graph.
 */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface VerificationEntryPoint {
    fun capabilityRegistry(): CapabilityRegistry
    fun deviceAccessPort(): DeviceAccessPort
    fun accessCoordinator(): AccessCoordinator
}
