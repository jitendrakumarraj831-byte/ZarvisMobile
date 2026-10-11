package com.zarvismobile.domain.conversation

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest

/**
 * The single source of truth for the active conversation. These are the properties every Chat screen, the orchestrator and the account
 * changes rely on: a New chat is visible to every observer at once, a late answer cannot select a conversation that was left, an epoch is never
 * reused (so a screen that missed changes can still tell), and the saved id always ends up equal to the active one.
 */
class ActiveConversationTest {
    /** A store that records what was written, and can make writes slow to interleave them. */
    private class FakeStore(var saved: String? = null, private val writeDelayMs: (String?) -> Long = { 0 }) : ConversationIdStore {
        var reads = 0
        val writes = mutableListOf<String?>()
        override suspend fun get(): String? {
            reads++
            return saved
        }
        override suspend fun set(id: String?) {
            val wait = writeDelayMs(id)
            if (wait > 0) delay(wait)
            writes += id
            saved = id
        }
    }

    @Test
    fun `the saved id is read once, on first use, and nothing is written for it`() = runTest {
        val store = FakeStore(saved = "chat-A")
        val active = ActiveConversation(store)
        assertNull(active.state.value, "nothing is known before the saved id has been read")
        val first = active.current()
        assertEquals("chat-A", first.id)
        assertEquals(first, active.current())
        assertEquals(1, store.reads)
        assertEquals(emptyList(), store.writes)
    }

    @Test
    fun `New chat clears the id, saves that, changes the epoch and reaches every observer`() = runTest {
        val store = FakeStore(saved = "chat-A")
        val active = ActiveConversation(store)
        val before = active.current()
        val seenByScreens = mutableListOf<ConversationStamp?>()
        val job = launch { active.state.collect { seenByScreens += it } }
        advanceUntilIdle()

        val fresh = active.startNew()
        advanceUntilIdle()

        assertNull(fresh.id)
        assertTrue(fresh.epoch != before.epoch)
        assertEquals(fresh, active.state.value)
        assertNull(store.saved)
        assertEquals(fresh, seenByScreens.last())
        job.cancel()
    }

    @Test
    fun `the first answer of a new chat gives it an id and leaves the epoch alone`() = runTest {
        val store = FakeStore()
        val active = ActiveConversation(store)
        val fresh = active.startNew()
        val adoption = active.adopt("chat-B", fresh.epoch)
        assertEquals(Adoption.Started(ConversationStamp("chat-B", fresh.epoch)), adoption)
        assertEquals("chat-B", store.saved)
        assertEquals(fresh.epoch, active.current().epoch)
    }

    @Test
    fun `an answer for the conversation that is already active changes nothing and writes nothing`() = runTest {
        val store = FakeStore(saved = "chat-A")
        val active = ActiveConversation(store)
        val now = active.current()
        assertEquals(Adoption.Same(now), active.adopt("chat-A", now.epoch))
        assertEquals(emptyList(), store.writes)
    }

    @Test
    fun `an answer that arrives after New chat is refused and does not select the old conversation`() = runTest {
        val store = FakeStore(saved = "chat-A")
        val active = ActiveConversation(store)
        val sentUnder = active.current() // the turn is sent under this stamp
        val fresh = active.startNew() // New chat while it is on its way
        val adoption = active.adopt("chat-A", sentUnder.epoch) // the late answer
        assertEquals(Adoption.Stale(fresh), adoption)
        assertEquals(fresh, active.current())
        assertNull(store.saved, "the late answer must not bring the old id back, in memory or on disk")
    }

    @Test
    fun `a server that answers in a different conversation is recorded and flagged, in the same epoch`() = runTest {
        val store = FakeStore(saved = "deleted-on-the-web")
        val active = ActiveConversation(store)
        val sentUnder = active.current()
        val adoption = active.adopt("brand-new", sentUnder.epoch)
        assertEquals(Adoption.Replaced(ConversationStamp("brand-new", sentUnder.epoch)), adoption)
        assertEquals("brand-new", store.saved)
    }

    @Test
    fun `forgetting a conversation only leaves it if it is the active one`() = runTest {
        val store = FakeStore(saved = "chat-A")
        val active = ActiveConversation(store)
        val before = active.current()
        assertFalse(active.forget("some-other-chat"))
        assertEquals(before, active.current())
        assertTrue(active.forget("chat-A"))
        assertNull(active.current().id)
        assertTrue(active.current().epoch != before.epoch)
        assertNull(store.saved)
    }

    @Test
    fun `an epoch is never reused, so a screen that missed the changes in between still sees one`() = runTest {
        val active = ActiveConversation(FakeStore(saved = "chat-A"))
        val shown = active.current() // a screen shows chat A and then looks away
        active.startNew() // New chat on another screen ...
        val now = active.adopt("chat-B", active.current().epoch).stamp // ... which then talks in chat B
        // The screen never saw the cleared state; all it ever sees is A (before) and B (after).
        assertTrue(shown.epoch != now.epoch)
        assertEquals("chat-B", now.id)
    }

    @Test
    fun `a New chat made while the saved id is still being read wins over it`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val store = object : ConversationIdStore {
            override suspend fun get(): String? {
                gate.await()
                return "old-saved"
            }
            override suspend fun set(id: String?) = Unit
        }
        val active = ActiveConversation(store)
        val loading = async { active.current() }
        advanceUntilIdle()
        val fresh = active.startNew()
        gate.complete(Unit)
        assertEquals(fresh, loading.await())
        assertNull(active.current().id)
    }

    @Test
    fun `what is saved ends up equal to what is active, whatever order slow writes finish in`() = runTest {
        // The write for "chat-B" is slow, the write for New chat is fast: they overlap.
        val store = FakeStore(saved = null, writeDelayMs = { if (it == "chat-B") 500 else 10 })
        val active = ActiveConversation(store)
        val fresh = active.startNew()
        val adopting = async { active.adopt("chat-B", fresh.epoch) }
        advanceUntilIdle()
        val newChat = async { active.startNew() }
        advanceUntilIdle()
        adopting.await()
        newChat.await()
        assertNull(active.current().id)
        assertNull(store.saved, "the saved value must be the latest active one, not the slowest write")
    }

    @Test
    fun `many New chats and answers from many threads leave a consistent state`() = runBlocking {
        val store = FakeStore()
        val active = ActiveConversation(store)
        active.current()
        val epochsSeen = java.util.concurrent.ConcurrentLinkedQueue<Long>()
        (1..300).map { n ->
            async(Dispatchers.Default) {
                if (n % 3 == 0) epochsSeen += active.startNew().epoch
                else {
                    val sentUnder = active.current()
                    active.adopt("chat-$n", sentUnder.epoch)
                }
            }
        }.awaitAll()
        val last = active.current()
        assertEquals(last.id, store.saved, "saved and active agree after the dust settles")
        assertEquals(epochsSeen.size, epochsSeen.toSet().size, "every New chat got its own epoch")
        assertTrue(last.epoch >= (epochsSeen.maxOrNull() ?: 0L))
    }
}
