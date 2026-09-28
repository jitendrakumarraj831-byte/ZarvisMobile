package com.zarvismobile.data.repository

import com.zarvismobile.core.security.SecureStorage
import com.zarvismobile.data.remote.SessionEvents
import com.zarvismobile.data.remote.TokenAuthenticator
import com.zarvismobile.data.remote.TokenStorageKeys
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.dto.LoginRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** What the app knows about the signed-in account on this device. */
sealed interface SessionState {
    /** First launch: no account on this device yet. */
    data object None : SessionState

    data class Active(val accountId: String, val isGuest: Boolean, val email: String?) : SessionState

    /**
     * The server ended this device's session (signed out elsewhere, token replay, account
     * deleted). The user decides: sign in again, or explicitly start a new guest account.
     */
    data class Expired(val reason: String, val lastEmail: String?, val wasGuest: Boolean) : SessionState
}

class SessionExpiredException(val reason: String) : IllegalStateException("Your session has ended. Sign in again to continue.")

/**
 * Account/session lifecycle for the Android app.
 *
 * - First launch creates a server-side guest account (POST /auth/guest).
 * - A guest can add an email/password (link) so the same account works on Web and other devices.
 * - Signing in with an email replaces this device's session with that account.
 * - If the server ends the session, nothing is created automatically: [ensureSession] throws
 *   [SessionExpiredException] and the UI asks the user what to do.
 */
class SessionRepository(
    private val api: ZarvisApi,
    private val secureStorage: SecureStorage,
) {
    private val _state = MutableStateFlow(readState())
    val state: StateFlow<SessionState> = _state.asStateFlow()

    /** Re-reads storage (e.g. after TokenAuthenticator marked the session expired). */
    fun refreshState(): SessionState = readState().also { _state.value = it }

    suspend fun ensureSession(): String {
        when (val current = refreshState()) {
            is SessionState.Active -> return current.accountId
            is SessionState.Expired -> throw SessionExpiredException(current.reason)
            SessionState.None -> Unit
        }
        return startGuestSession()
    }

    /** Explicit user action (first launch, or "Start a new guest session" after expiry). */
    suspend fun startGuestSession(): String {
        val tokens = api.createGuest()
        clearAccount()
        TokenAuthenticator.storeTokens(secureStorage, tokens)
        refreshState()
        return tokens.accountId
    }

    suspend fun signIn(email: String, password: String): SessionState.Active {
        val tokens = api.login(LoginRequest(email.trim(), password))
        clearAccount()
        TokenAuthenticator.storeTokens(secureStorage, tokens)
        return refreshState() as SessionState.Active
    }

    /** Adds an email/password to the current guest account. The account id and data stay the same. */
    suspend fun linkEmail(email: String, password: String): SessionState.Active {
        val identity = api.linkAccount(LoginRequest(email.trim(), password))
        secureStorage.putString(TokenStorageKeys.IS_GUEST, identity.isGuest.toString())
        identity.email?.let { secureStorage.putString(TokenStorageKeys.EMAIL, it) }
        return refreshState() as SessionState.Active
    }

    /** Revokes the session server-side (best effort) and forgets it on this device. */
    suspend fun signOut() {
        runCatching { api.logout() }
        clearAccount()
        refreshState()
    }

    /** Local-only forget (used after account deletion). */
    fun clearLocal() {
        clearAccount()
        refreshState()
    }

    fun requireAccountId(): String =
        secureStorage.getString(TokenStorageKeys.ACCOUNT_ID)
            ?: error("Session not initialized — ensureSession() must complete before this is called")

    private fun clearAccount() {
        listOf(
            TokenStorageKeys.ACCESS_TOKEN,
            TokenStorageKeys.REFRESH_TOKEN,
            TokenStorageKeys.ACCOUNT_ID,
            TokenStorageKeys.IS_GUEST,
            TokenStorageKeys.EMAIL,
            TokenStorageKeys.SESSION_EXPIRED,
        ).forEach(secureStorage::remove)
        SessionEvents.clear()
    }

    private fun readState(): SessionState {
        val accountId = secureStorage.getString(TokenStorageKeys.ACCOUNT_ID)
        val isGuest = secureStorage.getString(TokenStorageKeys.IS_GUEST)?.toBooleanStrictOrNull() ?: true
        val email = secureStorage.getString(TokenStorageKeys.EMAIL)
        val expired = secureStorage.getString(TokenStorageKeys.SESSION_EXPIRED) ?: SessionEvents.expired.value
        return when {
            expired != null -> SessionState.Expired(expired, lastEmail = email, wasGuest = isGuest)
            accountId != null && secureStorage.getString(TokenStorageKeys.REFRESH_TOKEN) != null ->
                SessionState.Active(accountId, isGuest, if (isGuest) null else email)
            else -> SessionState.None
        }
    }
}
