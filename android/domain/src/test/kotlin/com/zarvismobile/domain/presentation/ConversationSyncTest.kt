package com.zarvismobile.domain.presentation

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ConversationSyncTest {
    @Test
    fun `an answered turn is two messages and an unanswered one is one`() {
        assertEquals(0, ConversationSync.messagesOnScreen(turns = 0, answeredTurns = 0))
        assertEquals(1, ConversationSync.messagesOnScreen(turns = 1, answeredTurns = 0))
        assertEquals(5, ConversationSync.messagesOnScreen(turns = 3, answeredTurns = 2))
    }

    @Test
    fun `the longer server history replaces the screen, a shorter or equal one never does`() {
        assertTrue(ConversationSync.serverHasMore(onScreen = 2, onServer = 4, turnInFlight = false))
        assertFalse(ConversationSync.serverHasMore(onScreen = 4, onServer = 4, turnInFlight = false))
        assertFalse(ConversationSync.serverHasMore(onScreen = 4, onServer = 2, turnInFlight = false))
    }

    @Test
    fun `a turn in flight is never replaced by the server's history`() {
        assertFalse(ConversationSync.serverHasMore(onScreen = 2, onServer = 4, turnInFlight = true))
    }

    @Test
    fun `a new chat started elsewhere empties this screen`() {
        assertTrue(ConversationSync.startedElsewhere(previousId = "abc", currentId = null, turnInFlight = false))
    }

    @Test
    fun `the first message of a chat (no id yet, then an id) is not a new chat`() {
        assertFalse(ConversationSync.startedElsewhere(previousId = null, currentId = "abc", turnInFlight = false))
        assertFalse(ConversationSync.startedElsewhere(previousId = null, currentId = null, turnInFlight = false))
        assertFalse(ConversationSync.startedElsewhere(previousId = "abc", currentId = "abc", turnInFlight = false))
        assertFalse(ConversationSync.startedElsewhere(previousId = "abc", currentId = "def", turnInFlight = false))
    }

    @Test
    fun `a reset never lands in the middle of a turn`() {
        assertFalse(ConversationSync.startedElsewhere(previousId = "abc", currentId = null, turnInFlight = true))
    }
}
