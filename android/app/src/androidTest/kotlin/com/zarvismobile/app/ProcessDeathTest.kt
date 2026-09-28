package com.zarvismobile.app

import android.os.Process
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.zarvismobile.app.Device.entry
import com.zarvismobile.app.Device.evidence
import com.zarvismobile.domain.access.PendingAction
import com.zarvismobile.domain.access.RecoveryDecision
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Process death while an action is waiting on the user (run as two separate instrumentation
 * invocations by scripts/emulator/verify.sh):
 *
 * 1. [ProcessDeathPhase1]: start "call 5551234" (needs the Phone permission, not granted), wait
 *    until ZARVIS is showing its explanation, confirm the pending action is persisted, then
 *    kill this app process outright — no finally blocks, no cleanup, exactly like the system
 *    reclaiming a backgrounded app.
 * 2. [ProcessDeathPhase2]: in a brand-new process, the interrupted action is OFFERED again
 *    (never executed), and dismissing it clears it.
 */
@RunWith(AndroidJUnit4::class)
class ProcessDeathPhase1 {
    @Test
    fun killTheProcessWhileAnActionWaitsForTheUser() {
        ActivityScenario.launch(MainActivity::class.java)
        runBlocking { entry.pendingActionStore().clear() }
        CoroutineScope(Dispatchers.Default).launch {
            entry.orchestrator().handleTurn("call 5551234", accountId = "process-death-test")
        }
        assertTrue("ZARVIS asked for Phone access", Device.eventually(15_000) { entry.rationalePort().pending.value != null })
        val saved = runBlocking { entry.pendingActionStore().load() }
        assertNotNull(saved)
        assertEquals("call 5551234", saved!!.utterance)
        assertEquals(PendingAction.Stage.AWAITING_PERMISSION, saved.stage)
        evidence("process_death phase1 pending saved stage=${saved.stage} skill=${saved.skillId}; killing pid=${Process.myPid()}")
        Process.killProcess(Process.myPid())
    }
}

@RunWith(AndroidJUnit4::class)
class ProcessDeathPhase2 {
    @Test
    fun theInterruptedActionIsOfferedNotRun() = runBlocking {
        val decision = entry.orchestrator().checkInterruptedAction()
        assertTrue("offered after restart, got $decision", decision is RecoveryDecision.OfferResume)
        val action = (decision as RecoveryDecision.OfferResume).action
        assertEquals("call 5551234", action.utterance)
        // Nothing was executed: the call never started (no call permission, no dialer hand-off).
        val callState = Device.shell("dumpsys telephony.registry")
        assertTrue("no call in progress", !callState.contains("mCallState=2"))
        entry.orchestrator().dismissInterruptedAction()
        assertNull(entry.pendingActionStore().load())
        evidence("process_death phase2 new pid=${Process.myPid()} -> OfferResume(\"${action.utterance}\"), not executed; dismissed -> cleared")
    }
}
