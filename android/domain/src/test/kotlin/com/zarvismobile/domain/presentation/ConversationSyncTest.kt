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

    // ---- Two screens over one server conversation: switching to a fresh chat, and no leak from the old one --------------------------------

    private val chatA = listOf(m("user", "a1"), m("assistant", "answer a1"), m("user", "a2"), m("assistant", "answer a2"))
    private val chatB = listOf(m("user", "b1"), m("assistant", "answer b1"), m("user", "b2"), m("assistant", "answer b2"))

    private fun users(turns: List<TurnText>) = turns.map { it.user }

    @Test
    fun `switching to a fresh chat on the other screen shows only the new chat here, never the old one`() {
        // This screen shows chat A. The other screen taps New chat (the stored id is cleared): this screen empties.
        var shown = ConversationSync.pair(chatA)
        assertEquals(listOf("a1", "a2"), users(shown))
        assertTrue(ConversationSync.startedElsewhere(previousId = "chat-A", currentId = null, turnInFlight = false))
        shown = emptyList()

        // The other screen then talks in chat B. Coming back here, the server's chat B is shown from its start.
        val added = ConversationSync.newTurnsAfter(shownUsers = users(shown), messages = chatB)
        assertEquals(listOf("b1", "b2"), users(added!!))
        assertTrue((shown + added).none { it.user.startsWith("a") || it.assistant?.contains("a1") == true || it.assistant?.contains("a2") == true }, "nothing of chat A is left")
    }

    @Test
    fun `a fresh chat with nothing said yet shows nothing`() {
        assertEquals(emptyList(), ConversationSync.newTurnsAfter(shownUsers = emptyList(), messages = emptyList()))
    }

    @Test
    fun `if a reset was missed, another chat's exchanges are never added under this one`() {
        // This screen still shows chat A, and the server now answers with chat B's messages: the screen is left alone (null), and chat B's
        // exchanges are not appended below chat A's.
        assertNull(ConversationSync.newTurnsAfter(shownUsers = listOf("a1", "a2"), messages = chatB))
        // The same when chat B is longer than what is shown.
        assertNull(ConversationSync.newTurnsAfter(shownUsers = listOf("a1"), messages = chatB + m("user", "b3") + m("assistant", "answer b3")))
        // And when it is shorter.
        assertNull(ConversationSync.newTurnsAfter(shownUsers = listOf("a1", "a2", "a3"), messages = chatB))
    }

    @Test
    fun `continuing the same chat on the other screen adds only the new exchanges`() {
        val continued = chatA + m("user", "a3") + m("assistant", "answer a3")
        val added = ConversationSync.newTurnsAfter(shownUsers = listOf("a1", "a2"), messages = continued)
        assertEquals(listOf(TurnText("a3", "answer a3")), added)
    }

    @Test
    fun `the id changing from one chat straight to another is not treated as a reset`() {
        // Only a cleared id means "a new chat was started"; a screen never empties itself because of an id it cannot tell apart from its own.
        assertFalse(ConversationSync.startedElsewhere(previousId = "chat-A", currentId = "chat-B", turnInFlight = false))
        // Its own New chat, then its own first message: null, then an id, with a turn in flight.
        assertFalse(ConversationSync.startedElsewhere(previousId = null, currentId = "chat-B", turnInFlight = true))
    }
}
