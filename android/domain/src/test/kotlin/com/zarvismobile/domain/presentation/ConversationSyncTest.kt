package com.zarvismobile.domain.presentation

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ConversationSyncTest {
    private fun m(role: String, text: String) = role to text

    @Test
    fun `messages pair into exchanges without inventing a missing half`() {
        assertEquals(
            listOf(TurnText("hi", "hello"), TurnText("again", null)),
            ConversationSync.pair(listOf(m("user", "hi"), m("assistant", "hello"), m("user", "again"))),
        )
        assertEquals(listOf(TurnText("only", null)), ConversationSync.pair(listOf(m("user", "only"))))
        assertEquals(emptyList(), ConversationSync.pair(emptyList()))
    }

    @Test
    fun `a user message with no answer before the next user message stays unanswered`() {
        assertEquals(
            listOf(TurnText("a", null), TurnText("b", "B")),
            ConversationSync.pair(listOf(m("user", "a"), m("user", "b"), m("assistant", "B"))),
        )
    }

    @Test
    fun `the answer the server adds after a confirmation joins the exchange and never shows an empty question`() {
        // The server stores one more assistant message when the user approves or declines (backend/src/api/routes/confirmations.ts).
        val turns = ConversationSync.pair(listOf(m("user", "call mom"), m("assistant", "Confirm?"), m("assistant", "Done, calling.")))
        assertEquals(listOf(TurnText("call mom", "Confirm?\n\nDone, calling.")), turns)
        assertTrue(turns.none { it.user.isEmpty() })
    }

    @Test
    fun `a conversation that starts with an answer keeps it as an exchange with no question`() {
        assertEquals(listOf(TurnText("", "welcome")), ConversationSync.pair(listOf(m("assistant", "welcome"))))
    }

    @Test
    fun `other roles are ignored`() {
        assertEquals(listOf(TurnText("a", "A")), ConversationSync.pair(listOf(m("system", "x"), m("user", "a"), m("tool", "y"), m("assistant", "A"))))
    }

    @Test
    fun `the server's later exchanges are returned when the screen shows the start of the same conversation`() {
        val server = listOf(m("user", "a"), m("assistant", "A"), m("user", "b"), m("assistant", "B"), m("assistant", "B2"), m("user", "c"), m("assistant", "C"))
        assertEquals(
            listOf(TurnText("b", "B\n\nB2"), TurnText("c", "C")),
            ConversationSync.newTurnsAfter(shownUsers = listOf("a"), messages = server),
        )
        assertEquals(server.let { ConversationSync.pair(it) }, ConversationSync.newTurnsAfter(shownUsers = emptyList(), messages = server))
    }

    @Test
    fun `nothing is added when the screen is already up to date`() {
        val server = listOf(m("user", "a"), m("assistant", "A"), m("assistant", "A2"))
        assertEquals(emptyList(), ConversationSync.newTurnsAfter(shownUsers = listOf("a"), messages = server))
        assertEquals(emptyList(), ConversationSync.newTurnsAfter(shownUsers = emptyList(), messages = emptyList()))
    }

    @Test
    fun `a screen that is not the start of the server's conversation is left alone`() {
        val server = listOf(m("user", "a"), m("assistant", "A"), m("user", "b"), m("assistant", "B"))
        // an exchange only the phone knows (an on-device command the server never stored)
        assertNull(ConversationSync.newTurnsAfter(shownUsers = listOf("open whatsapp", "a"), messages = server))
        // the screen shows more than the server holds
        assertNull(ConversationSync.newTurnsAfter(shownUsers = listOf("a", "b", "c"), messages = server))
        // a different conversation altogether
        assertNull(ConversationSync.newTurnsAfter(shownUsers = listOf("x"), messages = server))
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
