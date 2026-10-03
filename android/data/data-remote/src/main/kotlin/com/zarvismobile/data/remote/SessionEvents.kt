package com.zarvismobile.data.remote

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Process-wide signal that the server definitively ended this device's session (refresh token
 * rejected as invalid/revoked/reused). The UI reacts by asking the user to sign in or to
 * explicitly start a new guest session — ZARVIS never silently swaps in a different account.
 */
object SessionEvents {
    private val _expired = MutableStateFlow<String?>(null)

    /** The server's reason code while the session is expired, otherwise null. */
    val expired: StateFlow<String?> = _expired.asStateFlow()

    fun markExpired(code: String) {
        _expired.value = code
    }

    fun clear() {
        _expired.value = null
    }
}
