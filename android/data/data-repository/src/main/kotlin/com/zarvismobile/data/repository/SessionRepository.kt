package com.zarvismobile.data.repository

import com.zarvismobile.core.security.SecureStorage
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.remote.TokenStorageKeys
import com.zarvismobile.data.remote.dto.SignupRequest
import java.util.UUID

/**
 * Bootstraps a backend account so the app is usable immediately on first launch, without a
 * signup screen — see MASTER_SPEC.md §15 "Free trial" and §29 (MVP Scope). This creates a
 * device-scoped account behind a random, unguessable local email; account **linking** to a
 * real email/password or OAuth identity (so a trial/subscription can follow the user across
 * devices) is planned, not implemented, in this pass.
 */
class SessionRepository(
    private val api: ZarvisApi,
    private val secureStorage: SecureStorage,
) {
    suspend fun ensureSession(): String {
        // Returns the stored account id as-is without checking it still exists server-side —
        // if it doesn't (e.g. the backend's user data was reset/migrated since this device
        // last bootstrapped), the first real API call after this will 401 and
        // TokenAuthenticator (data-remote module) transparently bootstraps a fresh guest
        // session and updates this same storage, the same way web/app.js's apiFetch
        // self-heals. Checking here too would just be a redundant network call this app
        // makes on every single launch for a case that resolves itself reactively anyway.
        secureStorage.getString(TokenStorageKeys.ACCOUNT_ID)?.let { return it }

        val deviceId = UUID.randomUUID().toString()
        val tokens = api.signup(
            SignupRequest(
                email = "guest-$deviceId@device.zarvismobile.local",
                password = UUID.randomUUID().toString(),
            ),
        )
        secureStorage.putString(TokenStorageKeys.ACCESS_TOKEN, tokens.accessToken)
        secureStorage.putString(TokenStorageKeys.REFRESH_TOKEN, tokens.refreshToken)
        secureStorage.putString(TokenStorageKeys.ACCOUNT_ID, tokens.accountId)
        return tokens.accountId
    }

    fun requireAccountId(): String =
        secureStorage.getString(TokenStorageKeys.ACCOUNT_ID)
            ?: error("Session not initialized — ensureSession() must complete before this is called")
}
