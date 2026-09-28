package com.zarvismobile.app

import android.os.Build
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.zarvismobile.app.di.VerificationEntryPoint
import com.zarvismobile.domain.capability.CapabilityId
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Proves the packaged registry and live permission reads work on a real Android runtime. */
@RunWith(AndroidJUnit4::class)
class EmulatorSmokeTest {
    @get:Rule val guard = verificationGuard()

    private val entry = EntryPointAccessors.fromApplication(
        ApplicationProvider.getApplicationContext<ZarvisApplication>(),
        VerificationEntryPoint::class.java,
    )

    @Test
    fun registryIsPackagedAndEveryPermissionStateIsReadable() = runBlocking {
        val registry = entry.capabilityRegistry()
        assertEquals(CapabilityId.entries.size, registry.capabilities.size)
        val states = registry.capabilities.flatMap { it.permissionTypes }.distinct().associateWith { entry.deviceAccessPort().state(it) }
        println("ZARVIS_EVIDENCE sdk=${Build.VERSION.SDK_INT} states=$states")
    }
}
