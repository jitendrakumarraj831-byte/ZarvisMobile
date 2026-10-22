package com.zarvismobile.domain.skill

/** Where a drafted message opens (`message.draft`). */
enum class MessageChannel {
    WHATSAPP,
    SMS,
    EMAIL,

    /** A named app that can share text (Telegram, Instagram, …): it opens with the text; the user picks the chat. */
    OTHER_APP,

    /** No app named and nobody to address: Android's share menu, where the user picks the app. */
    ANY_APP,
}

/**
 * A message for the user to send themselves. [recipientAddress] is a phone number (WhatsApp, SMS) or an email address (Email) when
 * one is known; [recipientName] is who the user named, for the summary.
 */
data class MessageDraft(
    val text: String,
    val channel: MessageChannel,
    val appName: String? = null,
    val recipientName: String? = null,
    val recipientAddress: String? = null,
)

sealed interface DraftResult {
    /**
     * [appName] is the app that now shows the draft. [addressed] is false when that app could not be told who it is for (a share:
     * the user picks the chat there).
     */
    data class Opened(val appName: String, val addressed: Boolean = true) : DraftResult

    /** [message] is honest text for the user: why no draft was opened (e.g. the app is not installed). */
    data class Unavailable(val message: String) : DraftResult
}

/** Platform seam for handing a message to another app as a draft (a share or SENDTO intent). It never sends anything. */
fun interface MessageDraftPort {
    suspend fun open(draft: MessageDraft): DraftResult
}

/** Where `app.search` shows results. */
enum class SearchTarget(val displayName: String) {
    WEB("the web"),
    YOUTUBE("YouTube"),
    MAPS("Maps"),
    DIRECTIONS("Maps"),
    PLAY_STORE("the Play Store"),
}

sealed interface SearchShown {
    /** [appName] is the app showing the results. */
    data class Shown(val appName: String) : SearchShown

    /** [message] is honest text for the user: nothing on the phone can show these results. */
    data class Unavailable(val message: String) : SearchShown
}

/** Platform seam for opening an app at its search results (or directions) for a query. */
fun interface AppSearchPort {
    suspend fun search(target: SearchTarget, query: String): SearchShown
}
