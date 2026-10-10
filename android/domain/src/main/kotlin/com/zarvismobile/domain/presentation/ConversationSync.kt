package com.zarvismobile.domain.presentation

/**
 * The Chat tab and a chat opened from Home are two screens over ONE server conversation. These are the two decisions that keep them
 * from disagreeing, kept here as plain functions so they can be tested.
 */
object ConversationSync {
    /** How many messages a screen shows: each turn is the user's message, plus the assistant's once it has answered. */
    fun messagesOnScreen(turns: Int, answeredTurns: Int): Int = turns + answeredTurns

    /** The server holds more of the conversation than the screen shows (the other screen continued it): show the longer one. Never mid-turn, never a shorter one. */
    fun serverHasMore(onScreen: Int, onServer: Int, turnInFlight: Boolean): Boolean = !turnInFlight && onServer > onScreen

    /** The device left its conversation (a new chat was started on the other screen, or the account changed): empty this screen too. */
    fun startedElsewhere(previousId: String?, currentId: String?, turnInFlight: Boolean): Boolean =
        previousId != null && currentId == null && !turnInFlight
}
