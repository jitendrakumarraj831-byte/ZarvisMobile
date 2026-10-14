package com.zarvismobile.app

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.zarvismobile.app.Device.entry
import com.zarvismobile.app.Device.evidence
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The Chat screen follows the ONE active conversation, in the real app against the real backend: a chat started somewhere else shows when Chat
 * is shown again, a New chat started somewhere else empties the open Chat screen at once, and an old chat never comes back on screen.
 *
 * "Somewhere else" is the app's own orchestrator (the object the Home chat and the assistant overlay use), driven directly, so the test needs no
 * second screen. The messages are plain greetings, which the backend answers itself, so no AI key is needed.
 */
@RunWith(AndroidJUnit4::class)
class ChatSyncTest {
    @get:Rule val guard = verificationGuard()
    @get:Rule val compose = createEmptyComposeRule()

    private fun count(text: String): Int = compose.onAllNodes(hasText(text)).fetchSemanticsNodes().size

    private fun waitForText(text: String) = compose.waitUntil(20_000) { count(text) >= 1 }

    private fun waitForNoText(text: String) = compose.waitUntil(20_000) { count(text) == 0 }

    private fun tap(tab: String) {
        compose.waitUntil(20_000) { compose.onAllNodes(hasText(tab) and hasClickAction()).fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodes(hasText(tab) and hasClickAction()).onFirst().performClick()
        compose.waitForIdle()
    }

    /** Leaving the app and coming back: the Chat screen is shown again, which is when it looks at the server. */
    private fun leaveAndComeBack(scenario: ActivityScenario<MainActivity>) {
        scenario.moveToState(Lifecycle.State.CREATED)
        scenario.moveToState(Lifecycle.State.RESUMED)
        compose.waitForIdle()
    }

    @Test
    fun chatFollowsTheActiveConversationAcrossNewChatsStartedElsewhere() {
        val orchestrator = entry.orchestrator()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val skip = hasText("Skip")
            val chatTab = hasText("Chat") and hasClickAction()
            compose.waitUntil(20_000) {
                compose.onAllNodes(skip).fetchSemanticsNodes().isNotEmpty() || compose.onAllNodes(chatTab).fetchSemanticsNodes().isNotEmpty()
            }
            if (compose.onAllNodes(skip).fetchSemanticsNodes().isNotEmpty()) compose.onAllNodes(skip).onFirst().performClick()
            try {
                runBlocking { orchestrator.startNewConversation() } // start from no chat, whatever an earlier test left
                tap("Chat")

                // 1. A chat started elsewhere appears when Chat is shown again.
                runBlocking { orchestrator.handleTurn("hello", "chat-sync-test") }
                leaveAndComeBack(scenario)
                waitForText("hello")
                evidence("chat sync: a chat started elsewhere is shown when Chat comes back")

                // 2. A New chat started elsewhere empties the open Chat screen, with nothing done on it.
                runBlocking { orchestrator.startNewConversation() }
                waitForNoText("hello")
                evidence("chat sync: New chat started elsewhere emptied the open Chat screen")

                // 3. A different chat is shown; the old one does not come back.
                runBlocking { orchestrator.handleTurn("hey zarvis", "chat-sync-test") }
                leaveAndComeBack(scenario)
                waitForText("hey zarvis")
                assertEquals("the first chat must not be on screen again", 0, count("hello"))

                // 4. Rapid navigation: away from Chat and back, and a recreated Activity, show the same single chat.
                tap("Home")
                tap("Chat")
                assertTrue(count("hey zarvis") >= 1)
                assertEquals(0, count("hello"))
                scenario.recreate()
                waitForText("hey zarvis")
                assertEquals(0, count("hello"))
                evidence("chat sync: after switching tabs and recreating the Activity only the active chat is shown")
            } finally {
                runBlocking { orchestrator.startNewConversation() } // leave no test chat selected
            }
        }
    }
}
