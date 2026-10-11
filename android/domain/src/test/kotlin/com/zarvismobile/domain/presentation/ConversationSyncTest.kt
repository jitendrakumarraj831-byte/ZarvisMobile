package com.zarvismobile.domain.presentation

import com.zarvismobile.domain.conversation.ConversationStamp
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

    // ---- Which conversation a screen's transcript belongs to ---------------------------------------------------------------------------

    private fun stamp(id: String?, epoch: Long) = ConversationStamp(id, epoch)
    private fun server(id: String?, epoch: Long, vararg messages: Pair<String, String>) = ServerConversation(stamp(id, epoch), messages.toList())

    private val chatA = listOf(m("user", "a1"), m("assistant", "answer a1"), m("user", "a2"), m("assistant", "answer a2"))
    private val chatB = listOf(m("user", "b1"), m("assistant", "answer b1"), m("user", "b2"), m("assistant", "answer b2"))

    private fun users(turns: List<TurnText>) = turns.map { it.user }

    @Test
    fun `a screen has left its conversation exactly when the epoch differs`() {
        assertTrue(ConversationSync.leftConversation(stamp("A", 1), stamp(null, 2)))
        assertTrue(ConversationSync.leftConversation(stamp("A", 1), stamp("B", 3))) // however many changes were missed
        assertFalse(ConversationSync.leftConversation(stamp(null, 2), stamp("A", 2))) // the first answer gives a chat its id: same conversation
        assertFalse(ConversationSync.leftConversation(stamp("A", 1), stamp("A", 1)))
        assertFalse(ConversationSync.leftConversation(null, stamp("A", 1))) // a screen that has not read the conversation yet has nothing to drop
    }

    @Test
    fun `what the server returns for another conversation than the one shown replaces it`() {
        val r = ConversationSync.reconcile(
            shown = stamp("A", 1), shownUsers = listOf("a1", "a2"), shownCount = 2,
            server = ServerConversation(stamp("B", 2), chatB), active = stamp("B", 2),
        )
        assertEquals(Reconciled.Replace(ConversationSync.pair(chatB), stamp("B", 2)), r)
    }

    @Test
    fun `a screen that never read a conversation shows what the server holds`() {
        val r = ConversationSync.reconcile(null, emptyList(), 0, ServerConversation(stamp("A", 1), chatA), stamp("A", 1))
        assertEquals(Reconciled.Replace(ConversationSync.pair(chatA), stamp("A", 1)), r)
    }

    @Test
    fun `a fresh empty chat stays as it is, and one the other screen has begun is shown`() {
        assertEquals(Reconciled.Keep, ConversationSync.reconcile(stamp(null, 4), emptyList(), 0, ServerConversation(stamp(null, 4), emptyList()), stamp(null, 4)))
        val r = ConversationSync.reconcile(stamp(null, 4), emptyList(), 0, ServerConversation(stamp("B", 4), chatB), stamp("B", 4))
        assertEquals(Reconciled.Replace(ConversationSync.pair(chatB), stamp("B", 4)), r)
    }

    @Test
    fun `the same conversation continued elsewhere adds only the new exchanges`() {
        val continued = chatA + m("user", "a3") + m("assistant", "answer a3")
        val r = ConversationSync.reconcile(stamp("A", 1), listOf("a1", "a2"), 2, ServerConversation(stamp("A", 1), continued), stamp("A", 1))
        assertEquals(Reconciled.Append(listOf(TurnText("a3", "answer a3")), stamp("A", 1)), r)
        assertEquals(Reconciled.Keep, ConversationSync.reconcile(stamp("A", 1), listOf("a1", "a2"), 2, ServerConversation(stamp("A", 1), chatA), stamp("A", 1)))
    }

    @Test
    fun `an answer from the server about a conversation the device has since left is ignored`() {
        // The screen asked about conversation A (epoch 1); by the time the server answered, New chat had made epoch 2 the active one.
        val r = ConversationSync.reconcile(stamp("A", 1), listOf("a1"), 1, ServerConversation(stamp("A", 1), chatA), stamp(null, 2))
        assertEquals(Reconciled.Keep, r)
    }

    @Test
    fun `a transcript with a phone-only exchange in the same chat is left alone, not replaced`() {
        // This chat is fresh (no id yet) and holds one exchange the server never stored; the server meanwhile has a chat of its own.
        val r = ConversationSync.reconcile(stamp(null, 4), listOf("call mum"), 1, ServerConversation(stamp("B", 4), chatB), stamp("B", 4))
        assertEquals(Reconciled.Keep, r)
    }

    @Test
    fun `a conversation the server replaced with a new one replaces what another screen shows`() {
        // Same epoch, but the id this screen showed is not the active one any more.
        val r = ConversationSync.reconcile(stamp("old", 5), listOf("a1"), 1, ServerConversation(stamp("new", 5), chatB), stamp("new", 5))
        assertEquals(Reconciled.Replace(ConversationSync.pair(chatB), stamp("new", 5)), r)
    }

    @Test
    fun `the reply to this screen's own turn is shown only if the conversation was not left`() {
        // Normal: the reply is recorded under the conversation the screen shows.
        assertEquals(OwnReply.Show(stamp("A", 1)), ConversationSync.finishOwnTurn(stamp("A", 1), stamp("A", 1), false, stamp("A", 1)))
        // The first answer of a fresh chat gives it an id: still shown, and the screen now belongs to the stamped conversation.
        assertEquals(OwnReply.Show(stamp("A", 1)), ConversationSync.finishOwnTurn(stamp(null, 1), stamp("A", 1), false, stamp("A", 1)))
        // An action done on the phone is not part of a server conversation.
        assertEquals(OwnReply.Show(stamp("A", 1)), ConversationSync.finishOwnTurn(stamp("A", 1), null, false, stamp("A", 1)))
        // The server answered in a new conversation: only this exchange is shown.
        assertEquals(OwnReply.Fresh(stamp("N", 1)), ConversationSync.finishOwnTurn(stamp("A", 1), stamp("N", 1), true, stamp("N", 1)))
    }

    @Test
    fun `the reply to a turn of a conversation the device left is discarded`() {
        // New chat elsewhere made epoch 2 active while the turn (sent under epoch 1) was on its way.
        assertEquals(OwnReply.Discard, ConversationSync.finishOwnTurn(stamp("A", 1), stamp("A", 1), false, stamp(null, 2)))
        // Even when this screen has already moved to the new conversation, a reply stamped with the old epoch stays out.
        assertEquals(OwnReply.Discard, ConversationSync.finishOwnTurn(stamp(null, 2), stamp("A", 1), false, stamp(null, 2)))
        // A phone-only action finishing after the screen moved on.
        assertEquals(OwnReply.Discard, ConversationSync.finishOwnTurn(stamp("A", 1), null, false, stamp(null, 2)))
    }
}
