package com.zarvismobile.domain.presentation

/**
 * Why a message sent to ZARVIS did not come back with an answer, decided from what really happened: the phone never reached the
 * server, the connection dropped while the server was working, the server failed, the same message is still being worked on, the
 * server refused the request, or the session ended. Each says what may or may not have happened, and whether trying again can
 * help. Retrying re-sends the same message with the same id (`clientTurnId`), so the server answers a finished turn from its
 * stored result and does not run again a tool that already finished (backend/src/agents/orchestrator.ts `claimTurn`).
 */
enum class TurnFailureKind(val text: UiString) {
    /** The request never got an answer from the server (no connection, the server could not be reached, a timeout before it answered). */
    OFFLINE(UiString.CHAT_FAIL_OFFLINE),

    /** The server had started on it and the connection dropped (or the reply stream ended) before the answer: part of it may have run. */
    INTERRUPTED(UiString.CHAT_FAIL_INTERRUPTED),

    /** The server answered with an error of its own (5xx, or an error inside the reply stream). */
    SERVER(UiString.CHAT_FAIL_SERVER),

    /** An earlier attempt at this same message is still being worked on (409 `turn_in_progress`). */
    BUSY(UiString.CHAT_FAIL_BUSY),

    /** The server refused this request as it is (another 4xx): sending it again unchanged will not help. */
    REJECTED(UiString.CHAT_FAIL_REJECTED),

    /** The session ended and could not be renewed (401): the app asks the user to sign in again. */
    SESSION(UiString.CHAT_FAIL_SESSION),
}

data class TurnFailure(val kind: TurnFailureKind, val retryable: Boolean) {
    fun message(locale: String): String = kind.text.text(locale)
}

object TurnFailures {
    /** A turn the server refused or failed before its reply stream started: [status] is the HTTP status, [code] the body's `code`. */
    fun fromHttp(status: Int, code: String?): TurnFailure = when {
        status == 401 -> TurnFailure(TurnFailureKind.SESSION, retryable = false)
        code == "turn_in_progress" -> TurnFailure(TurnFailureKind.BUSY, retryable = true)
        status == 408 || status == 425 || status == 429 || status >= 500 -> TurnFailure(TurnFailureKind.SERVER, retryable = true)
        else -> TurnFailure(TurnFailureKind.REJECTED, retryable = false)
    }

    /**
     * The `error` event of a reply stream that had started (backend/src/api/routes/orchestrator.ts): `code` names a known case, and
     * `retryable` is the server's own answer to "can trying again help" (absent: yes).
     */
    fun fromStreamError(code: String?, retryable: Boolean?): TurnFailure = when (code) {
        "turn_in_progress" -> TurnFailure(TurnFailureKind.BUSY, retryable = true)
        "client_turn_id_reused" -> TurnFailure(TurnFailureKind.REJECTED, retryable = false)
        else -> TurnFailure(TurnFailureKind.SERVER, retryable = retryable ?: true)
    }

    /**
     * A failed connection. [replyStarted] is true when the server had already answered with the start of its reply stream, so it was
     * working on the request when the connection was lost.
     */
    fun network(replyStarted: Boolean): TurnFailure =
        TurnFailure(if (replyStarted) TurnFailureKind.INTERRUPTED else TurnFailureKind.OFFLINE, retryable = true)
}
