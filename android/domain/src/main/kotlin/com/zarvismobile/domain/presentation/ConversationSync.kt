package com.zarvismobile.domain.presentation

import com.zarvismobile.domain.conversation.ConversationStamp

/** One exchange as text: what the user said and, once there is one, the answer. */
data class TurnText(val user: String, val assistant: String?)

/** What the server holds for the conversation a screen asked about. [stamp] is the active conversation at the moment it asked. */
data class ServerConversation(val stamp: ConversationStamp, val messages: List<Pair<String, String>>)

/** What a screen should do with what the server returned. */
sealed interface Reconciled {
    /** Leave the screen as it is. */
    data object Keep : Reconciled

    /** Add [turns] below what is shown; the screen now belongs to [stamp]. */
    data class Append(val turns: List<TurnText>, val stamp: ConversationStamp) : Reconciled

    /** Show [turns] instead of whatever is shown (which is another conversation, or nothing yet); the screen now belongs to [stamp]. */
    data class Replace(val turns: List<TurnText>, val stamp: ConversationStamp) : Reconciled
}

/** What a screen should do with the reply to a turn it sent itself. */
sealed interface OwnReply {
    /** The conversation was left while the reply was on its way: show nothing, say nothing. */
    data object Discard : OwnReply

    /** Show the reply under the exchanges already shown; the screen belongs to [stamp]. */
    data class Show(val stamp: ConversationStamp?) : OwnReply

    /** The server answered in a different conversation than the one shown: show only this exchange; the screen belongs to [stamp]. */
    data class Fresh(val stamp: ConversationStamp?) : OwnReply
}

/**
 * The Chat tab and a chat opened from Home are two screens over ONE server conversation (`ActiveConversation`). These are the decisions that keep
 * them from disagreeing, kept here as plain functions so they can be tested. A screen remembers the [ConversationStamp] its transcript belongs to;
 * every decision compares that with the stamp of the active conversation, so a screen that missed any number of changes still cannot keep, or add
 * to, the transcript of a conversation the device has left.
 */
object ConversationSync {
    /**
     * Pairs stored messages (role to content, oldest first) into exchanges without inventing a missing half. An assistant message that
     * follows another assistant message is a second answer to the same exchange (the server adds one after you approve or decline a
     * confirmation), so it is added to that answer; it never becomes an exchange with an empty question.
     */
    fun pair(messages: List<Pair<String, String>>): List<TurnText> {
        val turns = mutableListOf<TurnText>()
        var pendingUser: String? = null
        for ((role, content) in messages) {
            when (role) {
                "user" -> {
                    pendingUser?.let { turns += TurnText(it, null) }
                    pendingUser = content
                }
                "assistant" -> {
                    val user = pendingUser
                    val last = turns.lastOrNull()
                    if (user == null && last?.assistant != null) {
                        turns[turns.lastIndex] = last.copy(assistant = last.assistant + "\n\n" + content)
                    } else {
                        turns += TurnText(user ?: "", content)
                    }
                    pendingUser = null
                }
            }
        }
        pendingUser?.let { turns += TurnText(it, null) }
        return turns
    }

    /**
     * The exchanges the server has after the ones a screen already shows, or `null` when the screen is not simply the start of the server's
     * conversation (for example it holds a phone-only exchange the server never stored). `null` means "do not touch the screen": showing
     * nothing new is better than showing a wrong transcript. [shownUsers] are the user messages on screen, oldest first.
     */
    fun newTurnsAfter(shownUsers: List<String>, messages: List<Pair<String, String>>): List<TurnText>? {
        val userAt = messages.indices.filter { messages[it].first == "user" }
        if (userAt.size < shownUsers.size) return null
        for (i in shownUsers.indices) if (messages[userAt[i]].second != shownUsers[i]) return null
        if (userAt.size == shownUsers.size) return emptyList()
        return pair(messages.drop(userAt[shownUsers.size]))
    }

    /** True when what a screen shows belongs to a conversation the device has since left (its epoch differs from the active one). */
    fun leftConversation(shown: ConversationStamp?, active: ConversationStamp): Boolean = shown != null && shown.epoch != active.epoch

    /**
     * What to do with the server's messages for the active conversation, for a screen showing [shownCount] exchanges ([shownUsers] are their user
     * messages, oldest first) that belong to [shown]. [active] is the active conversation now, which may no longer be the one asked about.
     */
    fun reconcile(shown: ConversationStamp?, shownUsers: List<String>, shownCount: Int, server: ServerConversation, active: ConversationStamp): Reconciled {
        // The device left that conversation while the server was answering: what came back is not for any screen.
        if (server.stamp.epoch != active.epoch) return Reconciled.Keep
        val asked = server.stamp
        val otherConversation = shown == null || shown.epoch != asked.epoch ||
            (shown.id != null && asked.id != null && shown.id != asked.id)
        if (otherConversation) return Reconciled.Replace(pair(server.messages), asked)
        if (shownCount == 0) {
            val all = pair(server.messages)
            return if (all.isEmpty()) Reconciled.Keep else Reconciled.Replace(all, asked)
        }
        val added = newTurnsAfter(shownUsers, server.messages)
        return if (added.isNullOrEmpty()) Reconciled.Keep else Reconciled.Append(added, asked)
    }

    /**
     * What to do with the reply to a turn this screen sent. [reply] is the conversation the reply was recorded under (`null` for an action done on
     * the phone, which is not part of a server conversation); [replaced] is true when the server answered in a new conversation; [active] is the
     * active conversation now.
     */
    fun finishOwnTurn(shown: ConversationStamp?, reply: ConversationStamp?, replaced: Boolean, active: ConversationStamp?): OwnReply {
        val epoch = reply?.epoch ?: shown?.epoch
        if (active != null && epoch != null && epoch != active.epoch) return OwnReply.Discard
        if (shown != null && reply != null && shown.epoch != reply.epoch) return OwnReply.Discard
        return if (replaced) OwnReply.Fresh(reply) else OwnReply.Show(reply ?: shown)
    }
}
