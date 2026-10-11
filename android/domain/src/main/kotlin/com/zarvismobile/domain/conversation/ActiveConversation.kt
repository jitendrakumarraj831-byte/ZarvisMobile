package com.zarvismobile.domain.conversation

import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Where the id of the conversation this device continues is kept between launches. Only [ActiveConversation] writes to it. */
interface ConversationIdStore {
    suspend fun get(): String?
    suspend fun set(id: String?)
}

/**
 * One conversation as the device sees it: the server's [id] (`null` until the first turn of a new chat has been answered) and an [epoch].
 *
 * The epoch is a number that changes every time the device LEAVES a conversation (New chat, a conversation the server no longer has, a
 * different account) and at no other time; in particular, a chat getting its id from the first answer does not change it. Two stamps with
 * the same epoch are the same conversation, and an epoch is never reused, so a screen that missed any number of changes in between can still
 * tell that what it shows belongs to a conversation the device has left.
 */
data class ConversationStamp(val id: String?, val epoch: Long)

/** What happened when an answer from the server was recorded as the active conversation. */
sealed interface Adoption {
    /** The conversation the answer belongs to, or the active one if it was not recorded. */
    val stamp: ConversationStamp

    /** The answer was already for the active conversation. */
    data class Same(override val stamp: ConversationStamp) : Adoption

    /** A new chat has its id now. The epoch is unchanged: it is the same conversation. */
    data class Started(override val stamp: ConversationStamp) : Adoption

    /**
     * The server answered in a different conversation than the one the turn was sent to (it did not know that id, e.g. the conversation was
     * deleted on the web) and created a new one. What a screen showed for the old one is not this conversation's history.
     */
    data class Replaced(override val stamp: ConversationStamp) : Adoption

    /** The device left the conversation while the turn was in flight: the answer belongs to the past and is not recorded. */
    data class Stale(override val stamp: ConversationStamp) : Adoption
}

/**
 * The single source of truth for which server conversation is active on this device. The orchestrator, both Chat screens (the tab and a chat
 * opened from Home) and everything that ends an account session go through this one object, so there is no second copy that can disagree:
 *
 * - [state] is what every screen watches. `null` only until the saved id has been read.
 * - A change is made in memory first, atomically, and then written to [store] (the latest value, in order), so a New chat is visible to every
 *   observer at once and a slow write cannot bring an old id back.
 * - A turn remembers the stamp it was sent under and records its answer with [adopt]; an answer for a conversation that was left meanwhile
 *   is refused ([Adoption.Stale]) instead of selecting the old conversation again.
 */
class ActiveConversation(private val store: ConversationIdStore) {
    private val epochs = AtomicLong(0)
    private val current = MutableStateFlow<ConversationStamp?>(null)
    private val loadLock = Mutex()
    private val persistLock = Mutex()

    val state: StateFlow<ConversationStamp?> = current.asStateFlow()

    /** The active conversation, reading the saved id the first time. */
    suspend fun current(): ConversationStamp {
        current.value?.let { return it }
        return loadLock.withLock {
            current.value ?: run {
                val loaded = ConversationStamp(store.get(), epochs.get())
                // A New chat made while the saved id was being read wins over what was saved.
                if (current.compareAndSet(null, loaded)) loaded else checkNotNull(current.value)
            }
        }
    }

    /** New chat (or a different account): no conversation is active, and every screen that shows the old one must drop it. */
    suspend fun startNew(): ConversationStamp {
        val next = ConversationStamp(null, epochs.incrementAndGet())
        current.value = next
        persist()
        return next
    }

    /** Records the conversation the server answered in, for a turn that was sent while the active conversation was at [turnEpoch]. */
    suspend fun adopt(id: String, turnEpoch: Long): Adoption {
        current()
        while (true) {
            val before = checkNotNull(current.value)
            if (before.epoch != turnEpoch) return Adoption.Stale(before)
            val (after, adoption) = when {
                before.id == id -> before to Adoption.Same(before)
                before.id == null -> ConversationStamp(id, before.epoch).let { it to Adoption.Started(it) }
                else -> ConversationStamp(id, before.epoch).let { it to Adoption.Replaced(it) }
            }
            if (after == before || current.compareAndSet(before, after)) {
                if (adoption !is Adoption.Same) persist()
                return adoption
            }
        }
    }

    /** The server no longer has conversation [id]. If it is the active one, the device leaves it; otherwise nothing changes. */
    suspend fun forget(id: String): Boolean {
        current()
        while (true) {
            val before = checkNotNull(current.value)
            if (before.id != id) return false
            if (current.compareAndSet(before, ConversationStamp(null, epochs.incrementAndGet()))) {
                persist()
                return true
            }
        }
    }

    /** Writes the latest in-memory id, whatever order the callers got here in, so the saved value always ends up equal to [state]. */
    private suspend fun persist() {
        persistLock.withLock { store.set(current.value?.id) }
    }
}
