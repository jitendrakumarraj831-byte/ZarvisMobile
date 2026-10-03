package com.zarvismobile.app

import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.zarvismobile.app.Device.evidence
import com.zarvismobile.app.Device.ui
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * One user turn = one execution across the Activity lifecycle. A request started from Home
 * (a quick-category chip opens the conversation with submit=true) must not be sent again when
 * the Activity is recreated (rotation, dark mode, recreation) or brought back from the
 * background. Before the fix, ConversationScreen's LaunchedEffect re-submitted it on every
 * recreation, so the same user message appeared — and was sent to the backend — twice.
 */
@RunWith(AndroidJUnit4::class)
class ConversationLifecycleTest {
    @get:Rule val guard = verificationGuard()
    @get:Rule val compose = createEmptyComposeRule()

    private val request = "Write a short product description"

    /** Number of user bubbles showing exactly [request]. */
    private fun sentCount(): Int = compose.onAllNodes(hasText(request)).fetchSemanticsNodes().size

    private fun settleAndCount(): Int {
        // Give a (wrongly) re-launched effect time to add a second bubble before counting.
        compose.mainClock.advanceTimeBy(3_000)
        compose.waitForIdle()
        Thread.sleep(1_500)
        compose.waitForIdle()
        return sentCount()
    }

    @Test
    fun aStartedRequestRunsOnceAcrossRecreationRotationAndBackground() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val skip = hasText("Skip")
            val chip = hasText("Creative")
            compose.waitUntil(20_000) {
                compose.onAllNodes(skip).fetchSemanticsNodes().isNotEmpty() ||
                    compose.onAllNodes(chip).fetchSemanticsNodes().isNotEmpty()
            }
            if (compose.onAllNodes(skip).fetchSemanticsNodes().isNotEmpty()) compose.onAllNodes(skip).onFirst().performClick()
            compose.waitUntil(20_000) { compose.onAllNodes(chip).fetchSemanticsNodes().isNotEmpty() }
            compose.onAllNodes(chip).onFirst().performClick()

            compose.waitUntil(20_000) { sentCount() >= 1 }
            assertEquals("sent once on submit", 1, settleAndCount())
            evidence("lifecycle submit: user bubbles=${sentCount()}")

            scenario.recreate()
            assertEquals("not re-sent after Activity recreation", 1, settleAndCount())
            evidence("lifecycle recreate: user bubbles=${sentCount()}")

            runCatching { ui.setOrientationLeft() }
            assertEquals("not re-sent after rotation", 1, settleAndCount())
            runCatching { ui.setOrientationNatural() }
            assertEquals("not re-sent after rotating back", 1, settleAndCount())
            evidence("lifecycle rotation: user bubbles=${sentCount()}")

            scenario.moveToState(Lifecycle.State.CREATED)
            scenario.moveToState(Lifecycle.State.RESUMED)
            assertEquals("not re-sent after background/foreground", 1, settleAndCount())
            evidence("lifecycle background->foreground: user bubbles=${sentCount()}")
        }
        runCatching { ui.unfreezeRotation() }
    }
}
