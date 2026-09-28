package com.zarvismobile.app

import org.junit.rules.TestWatcher
import org.junit.runner.Description

/** On any failure, records what was on screen so the CI log explains it (not just "not shown"). */
class DiagnoseOnFailure : TestWatcher() {
    override fun failed(e: Throwable, description: Description) {
        Device.diagnose("${description.testClass.simpleName}.${description.methodName}: ${e.message}")
    }
}
