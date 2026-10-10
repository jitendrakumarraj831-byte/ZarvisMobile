package com.zarvismobile.domain.presentation

/** One exchange as text: what the user said and, once there is one, the answer. */
data class TurnText(val user: String, val assistant: String?)

/**
 * The Chat tab and a chat opened from Home are two screens over ONE server conversation. These are the decisions that keep them from
 * disagreeing, kept here as plain functions so they can be tested.
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

    /** The device left its conversation (a new chat was started on the other screen, or the account changed): empty this screen too. */
    fun startedElsewhere(previousId: String?, currentId: String?, turnInFlight: Boolean): Boolean =
        previousId != null && currentId == null && !turnInFlight
}
