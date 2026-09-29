package com.zarvismobile.app

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.zarvismobile.app.Device.evidence
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Not a verification test: on the Android 8.x image, System UI crashes (a platform NPE in
 * StatusBar.onKeyguardOccludedChanged) the first few times an activity launched through
 * ActivityScenario toggles the keyguard's "occluded" state. verify.sh runs this until System UI
 * stops crashing, so the permission tests that follow see Android's own dialogs, not the crash
 * dialog. Its result is never counted as evidence of any capability.
 */
@RunWith(AndroidJUnit4::class)
class SystemWarmUp {
    @Test
    fun launchActivitiesUntilSystemUiIsStable() {
        repeat(4) { round ->
            runCatching { ActivityScenario.launch(MainActivity::class.java).use { Thread.sleep(2_000) } }
            Device.dismissSystemErrorDialogs()
            Thread.sleep(1_000)
            evidence("warm-up round ${round + 1}: systemui running=${Device.systemUiRunning()}")
        }
    }
}
