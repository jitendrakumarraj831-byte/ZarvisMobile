package com.zarvismobile.app

import java.util.concurrent.TimeUnit
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.rules.TestWatcher
import org.junit.rules.Timeout
import org.junit.runner.Description

/** On any failure, records what was on screen so the CI log explains it (not just "not shown"). */
class DiagnoseOnFailure : TestWatcher() {
    override fun starting(description: Description) {
        Device.awaitSystemReady()
    }

    override fun failed(e: Throwable, description: Description) {
        Device.diagnose("${description.testClass.simpleName}.${description.methodName}: ${e.message}")
    }
}

/**
 * Every emulator test: a hang fails after [minutes] with the stuck thread's stack trace (instead
 * of silently eating the CI job), and any failure — timeout included — records the screen.
 */
fun verificationGuard(minutes: Long = 4): TestRule =
    RuleChain.outerRule(DiagnoseOnFailure())
        .around(Timeout.builder().withTimeout(minutes, TimeUnit.MINUTES).withLookingForStuckThread(true).build())
