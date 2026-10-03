package com.zarvismobile.app

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.Until
import com.zarvismobile.app.Device.APP
import com.zarvismobile.app.Device.evidence
import com.zarvismobile.app.Device.shell
import com.zarvismobile.app.Device.ui
import com.zarvismobile.domain.entity.PermissionType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Not a verification test and never counted as evidence. On the Android 8.x emulator image,
 * showing Android's own runtime-permission dialog crashes System UI a few times (a platform NPE
 * in StatusBar.onKeyguardOccludedChanged; stacks are printed by verify.sh) before it settles.
 * verify.sh runs this until System UI stops crashing, so the permission tests that follow meet
 * Android's real dialog rather than the crash dialog. It uses location, which no permission-flow
 * test asks for, and revokes it afterwards (the location test grants it explicitly).
 */
@RunWith(AndroidJUnit4::class)
class SystemWarmUp {
    @Test
    fun showAndroidsPermissionDialogUntilSystemUiIsStable() {
        ActivityScenario.launch(MainActivity::class.java).use {
            repeat(4) { round ->
                val request = CoroutineScope(Dispatchers.Default).async { ActivityBridge.request(listOf(PermissionType.LOCATION)) }
                val deny = ui.wait(Until.findObject(Device.systemDenyButton()), 8_000)
                runCatching { deny?.click() }
                Device.dismissSystemErrorDialogs()
                runBlocking { withTimeoutOrNull(10_000) { request.await() } }
                Thread.sleep(1_000)
                evidence("warm-up round ${round + 1}: permission dialog shown=${deny != null} systemui running=${Device.systemUiRunning()}")
            }
        }
        shell("pm revoke $APP android.permission.ACCESS_COARSE_LOCATION")
    }
}
