package com.zarvismobile.domain.presentation

import com.zarvismobile.domain.conversation.ActiveConversation
import com.zarvismobile.domain.conversation.Adoption
import com.zarvismobile.domain.conversation.ConversationIdStore
import com.zarvismobile.domain.conversation.ConversationStamp
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking

/**
 * Two Chat screens (the Chat tab and a chat opened from Home) over one device, one server and one [ActiveConversation], driven through the
 * situations the audit named: a chat started on the other screen, rapid navigation, reopening Chat, switching conversations, a late reply.
 *
 * [Screen] makes the same calls `ConversationViewModel` makes, in the same order, with the same pure decisions from [ConversationSync]; the
 * ViewModel itself needs Android and Hilt, and is covered on the emulator by `ChatSyncTest`.
 */
class ChatScreensScenarioTest {
    /** A backend that keeps conversations by id and, like the real one, starts a new conversation for an id it does not know. */
    private class Server {
        val chats = linkedMapOf<String, MutableList<Pair<String, String>>>()
        private var next = 0

        fun answer(idSent: String?, text: String): String {
            val known = idSent != null && chats.containsKey(idSent)
            val id = if (known) idSent!! else "chat-${++next}"
            chats.getOrPut(id) { mutableListOf() } += listOf("user" to text, "assistant" to "answer to $text")
            return id
        }

        fun messages(id: String): List<Pair<String, String>> = chats[id]?.toList() ?: error("conversation_not_found")
    }

    private class MemoryStore(var saved: String? = null) : ConversationIdStore {
        override suspend fun get(): String? = saved
        override suspend fun set(id: String?) {
            saved = id
        }
    }

    private class Device {
        val store = MemoryStore()
        val active = ActiveConversation(store)
        val server = Server()
    }

    private class Screen(private val device: Device) {
        var shown: ConversationStamp? = null
        var turns = listOf<TurnText>()
        var turnInFlight: String? = null

        /** What the screen does when it is created. */
        suspend fun open() {
            shown = device.active.current()
            reconcile()
        }

        /** What it does for each new value of the active conversation, if it is watching (a screen that is not watching simply never calls this). */
        suspend fun observe() {
            val active = device.active.state.value ?: return
            if (!ConversationSync.leftConversation(shown, active)) return
            turnInFlight = null // the turn of the conversation that was left is cancelled
            shown = active
            turns = emptyList()
            if (active.id != null) reconcile()
        }

        /** Coming back to the screen. */
        suspend fun resume() {
            if (turnInFlight == null) reconcile()
        }

        private suspend fun reconcile() {
            val asked = device.active.current()
            val id = asked.id
            val messages = if (id == null) emptyList() else runCatching { device.server.messages(id) }.getOrElse {
                device.active.forget(id)
                emptyList()
            }
            val active = device.active.current()
            when (val d = ConversationSync.reconcile(shown, turns.map { it.user }.filter { it.isNotEmpty() }, turns.size, ServerConversation(asked, messages), active)) {
                Reconciled.Keep -> Unit
                is Reconciled.Append -> if (turnInFlight == null) { shown = d.stamp; turns = turns + d.turns }
                is Reconciled.Replace -> if (turnInFlight == null) { shown = d.stamp; turns = d.turns }
            }
        }

        /** New chat tapped on this screen. */
        suspend fun newChat() {
            turnInFlight = null
            turns = emptyList()
            val fresh = device.active.startNew()
            if ((shown?.epoch ?: -1L) < fresh.epoch) shown = fresh
        }

        /** The user sends [text]; [beforeReply] runs while the reply is on its way (something happening on another screen). */
        suspend fun say(text: String, beforeReply: suspend () -> Unit = {}) {
            turnInFlight = text
            turns = turns + TurnText(text, null)
            val sent = device.active.current()
            val idAnswered = device.server.answer(sent.id, text)
            beforeReply()
            val adoption = device.active.adopt(idAnswered, sent.epoch)
            val recorded = if (adoption is Adoption.Stale) sent else adoption.stamp
            if (turnInFlight == null) return // cancelled because the conversation was left
            when (val r = ConversationSync.finishOwnTurn(shown, recorded, adoption is Adoption.Replaced, device.active.state.value)) {
                is OwnReply.Discard -> { observe(); turnInFlight = null }
                is OwnReply.Show -> {
                    shown = r.stamp ?: shown
                    turns = turns.dropLast(1) + TurnText(text, "answer to $text")
                    turnInFlight = null
                }
                is OwnReply.Fresh -> {
                    shown = r.stamp ?: shown
                    turns = listOf(TurnText(text, "answer to $text"))
                    turnInFlight = null
                }
            }
        }

        val users get() = turns.map { it.user }
    }

    @Test
    fun `a chat started on the other screen is shown here when this screen comes back`() = runBlocking<Unit> {
        val device = Device()
        val chatTab = Screen(device).also { it.open() }
        val fromHome = Screen(device).also { it.open() }
        fromHome.say("plan my trip")
        chatTab.resume()
        assertEquals(listOf("plan my trip"), chatTab.users)
        assertEquals("answer to plan my trip", chatTab.turns.single().assistant)
    }

    @Test
    fun `New chat on one screen empties the other at once, and neither shows the old chat again`() = runBlocking<Unit> {
        val device = Device()
        val chatTab = Screen(device).also { it.open() }
        val fromHome = Screen(device).also { it.open() }
        chatTab.say("first topic")
        fromHome.resume()
        assertEquals(listOf("first topic"), fromHome.users)

        fromHome.newChat()
        assertEquals(emptyList(), fromHome.users)
        chatTab.observe() // the Chat tab is watching, even though it is not on screen
        assertEquals(emptyList(), chatTab.users)

        chatTab.resume()
        fromHome.resume()
        assertEquals(emptyList(), chatTab.users)
        assertEquals(emptyList(), fromHome.users)
    }

    @Test
    fun `a screen that was not watching still drops the old chat when it comes back`() = runBlocking<Unit> {
        val device = Device()
        val chatTab = Screen(device).also { it.open() }
        chatTab.say("first topic")
        val fromHome = Screen(device).also { it.open() }
        fromHome.newChat() // chatTab never observes this
        assertEquals(listOf("first topic"), chatTab.users, "still showing the old chat: it has not looked yet")
        chatTab.resume()
        assertEquals(emptyList(), chatTab.users)
    }

    @Test
    fun `rapid navigation, with a new chat and a new conversation in between, never leaves the old chat on a screen`() = runBlocking<Unit> {
        val device = Device()
        val chatTab = Screen(device).also { it.open() }
        chatTab.say("topic one")
        val fromHome = Screen(device).also { it.open() }
        // The other screen races through New chat, a chat, New chat, another chat. The Chat tab sees none of it.
        fromHome.newChat(); fromHome.say("topic two")
        fromHome.newChat(); fromHome.say("topic three")
        // One look at the end: it shows the chat that is active now and nothing of the first two.
        chatTab.resume()
        assertEquals(listOf("topic three"), chatTab.users)
        fromHome.resume()
        assertEquals(listOf("topic three"), fromHome.users)
    }

    @Test
    fun `reopening Chat shows the active conversation from the server, not the one it showed last time`() = runBlocking<Unit> {
        val device = Device()
        val first = Screen(device).also { it.open() }
        first.say("topic one")
        // The screen is closed (its transcript is gone); another one starts a new chat and talks.
        val other = Screen(device).also { it.open() }
        other.newChat(); other.say("topic two")
        val reopened = Screen(device).also { it.open() }
        assertEquals(listOf("topic two"), reopened.users)
        assertTrue(reopened.turns.none { it.user == "topic one" })
    }

    @Test
    fun `reopening Chat right after New chat shows an empty chat`() = runBlocking<Unit> {
        val device = Device()
        val first = Screen(device).also { it.open() }
        first.say("topic one")
        first.newChat()
        val reopened = Screen(device).also { it.open() }
        assertEquals(emptyList(), reopened.users)
        assertNull(device.store.saved)
    }

    @Test
    fun `switching to a new conversation and back to talking never mixes the two`() = runBlocking<Unit> {
        val device = Device()
        val screen = Screen(device).also { it.open() }
        screen.say("a1"); screen.say("a2")
        val chatA = device.active.current().id!!
        screen.newChat()
        screen.say("b1")
        val chatB = device.active.current().id!!
        assertTrue(chatA != chatB)
        assertEquals(listOf("b1"), screen.users)
        assertEquals(listOf("a1", "a2"), device.server.messages(chatA).filter { it.first == "user" }.map { it.second }, "chat A on the server is untouched")
        assertEquals(listOf("b1"), device.server.messages(chatB).filter { it.first == "user" }.map { it.second })
        screen.resume()
        assertEquals(listOf("b1"), screen.users)
    }

    @Test
    fun `the reply to a turn that a New chat on the other screen overtook is not shown in the new chat`() = runBlocking<Unit> {
        val device = Device()
        val chatTab = Screen(device).also { it.open() }
        val fromHome = Screen(device).also { it.open() }
        chatTab.say("topic one")
        chatTab.say("a slow one") { // while this reply is on its way, the other screen starts a new chat and the Chat tab notices
            fromHome.newChat()
            chatTab.observe()
        }
        assertEquals(emptyList(), chatTab.users, "neither the slow question nor its reply lands in the new chat")
        assertNull(device.active.current().id, "and the late reply did not select the old conversation again")
        chatTab.resume()
        assertEquals(emptyList(), chatTab.users)
    }

    @Test
    fun `the reply is discarded even if the screen did not notice the New chat before it arrived`() = runBlocking<Unit> {
        val device = Device()
        val chatTab = Screen(device).also { it.open() }
        val fromHome = Screen(device).also { it.open() }
        chatTab.say("a slow one") { fromHome.newChat() } // the Chat tab never observed it
        assertEquals(emptyList(), chatTab.users)
        assertNull(device.active.current().id)
    }

    @Test
    fun `a conversation the server no longer has is replaced by a new one, on every screen`() = runBlocking<Unit> {
        val device = Device()
        val chatTab = Screen(device).also { it.open() }
        val fromHome = Screen(device).also { it.open() }
        chatTab.say("old topic")
        fromHome.resume()
        assertEquals(listOf("old topic"), fromHome.users)
        val oldId = device.active.current().id!!
        device.server.chats.remove(oldId) // deleted on the web

        chatTab.say("new topic") // the server starts a new conversation for the id it does not know
        assertEquals(listOf("new topic"), chatTab.users, "this screen shows only the exchange that exists in the new conversation")
        fromHome.resume()
        assertEquals(listOf("new topic"), fromHome.users, "the other screen drops the transcript of the vanished conversation")
    }

    @Test
    fun `a conversation that vanished is left when a screen asks for it`() = runBlocking<Unit> {
        val device = Device()
        val chatTab = Screen(device).also { it.open() }
        chatTab.say("old topic")
        val reopened = Screen(device).also { it.open() }
        device.server.chats.clear() // deleted on the web
        reopened.resume() // asks the server, which does not know the id: the device leaves it
        assertNull(device.active.current().id)
        chatTab.observe() // every screen watching the active conversation sees the change, the one that asked included
        reopened.observe()
        assertEquals(emptyList(), chatTab.users)
        assertEquals(emptyList(), reopened.users)
    }

    @Test
    fun `signing out or changing account leaves the conversation on every screen`() = runBlocking<Unit> {
        val device = Device()
        val chatTab = Screen(device).also { it.open() }
        val fromHome = Screen(device).also { it.open() }
        chatTab.say("private topic")
        fromHome.resume()
        device.active.startNew() // what sign-out / sign-in / delete account / a new guest do
        chatTab.observe()
        fromHome.observe()
        assertEquals(emptyList(), chatTab.users)
        assertEquals(emptyList(), fromHome.users)
        assertNull(device.store.saved)
    }

    @Test
    fun `the answer of a server read that started before New chat is not applied`() = runBlocking<Unit> {
        val device = Device()
        val chatTab = Screen(device).also { it.open() }
        chatTab.say("topic one")
        val asked = device.active.current() // the screen asks the server about this conversation ...
        val messages = device.server.messages(asked.id!!)
        device.active.startNew() // ... and New chat happens before the answer is applied
        val decision = ConversationSync.reconcile(null, emptyList(), 0, ServerConversation(asked, messages), device.active.current())
        assertEquals(Reconciled.Keep, decision)
    }
}
