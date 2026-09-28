package com.zarvismobile.data.remote

import com.zarvismobile.core.security.SecureStorage
import com.zarvismobile.data.remote.dto.ApiErrorResponse
import com.zarvismobile.data.remote.dto.AuthTokensResponse
import com.zarvismobile.data.remote.dto.RefreshRequest
import java.io.IOException
import kotlinx.serialization.json.Json
import okhttp3.Authenticator
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route

/**
 * Refreshes an expired access token on a 401 (the refresh token rotates on every use).
 *
 * Outcomes are kept strictly apart so an account is never silently replaced:
 * - refreshed → retry the request with the new token;
 * - the server definitively rejected the session (401 with a session_* / refresh_token_reused
 *   code) → tokens are cleared, [SessionEvents] is marked expired and the UI asks the user to
 *   sign in or to explicitly start a new guest session;
 * - network error / 5xx / anything else → nothing is cleared; the request just fails and the
 *   user sees a connectivity error. The same account is used again on the next attempt.
 *
 * Talks to the auth endpoint with a bare [OkHttpClient] because the Retrofit client this
 * authenticator is attached to cannot be depended on here without a cycle.
 */
class TokenAuthenticator(
    private val baseUrl: String,
    private val secureStorage: SecureStorage,
    private val authHttp: OkHttpClient = OkHttpClient(),
) : Authenticator {
    private val json = Json { ignoreUnknownKeys = true }
    private val jsonMedia = "application/json".toMediaType()

    sealed interface RefreshOutcome {
        data class Refreshed(val accessToken: String) : RefreshOutcome
        data class Rejected(val code: String) : RefreshOutcome
        data object Unreachable : RefreshOutcome
    }

    override fun authenticate(route: Route?, response: Response): Request? {
        if (responseCount(response) >= 2) return null // already retried once — don't loop
        val newAccessToken = refreshOnce(response.request) ?: return null
        return response.request.newBuilder()
            .header("Authorization", "Bearer $newAccessToken")
            .build()
    }

    private fun responseCount(response: Response): Int {
        var count = 1
        var prior = response.priorResponse
        while (prior != null) {
            count++
            prior = prior.priorResponse
        }
        return count
    }

    /**
     * Synchronized so concurrent 401s refresh once: a caller whose failed request used an
     * older token than the one now stored reuses the stored token instead of refreshing again
     * (which would present an already-rotated refresh token and revoke the session).
     */
    @Synchronized
    private fun refreshOnce(failedRequest: Request): String? {
        val tokenOnFailedRequest = failedRequest.header("Authorization")?.removePrefix("Bearer ")
        val currentlyStored = secureStorage.getString(TokenStorageKeys.ACCESS_TOKEN)
        if (currentlyStored != null && currentlyStored != tokenOnFailedRequest) return currentlyStored

        return when (val outcome = refresh()) {
            is RefreshOutcome.Refreshed -> outcome.accessToken
            is RefreshOutcome.Rejected -> {
                secureStorage.remove(TokenStorageKeys.ACCESS_TOKEN)
                secureStorage.remove(TokenStorageKeys.REFRESH_TOKEN)
                secureStorage.putString(TokenStorageKeys.SESSION_EXPIRED, outcome.code)
                SessionEvents.markExpired(outcome.code)
                null
            }
            RefreshOutcome.Unreachable -> null
        }
    }

    fun refresh(): RefreshOutcome {
        val refreshToken = secureStorage.getString(TokenStorageKeys.REFRESH_TOKEN)
            ?: return RefreshOutcome.Rejected("session_invalid")
        val body = json.encodeToString(RefreshRequest.serializer(), RefreshRequest(refreshToken)).toRequestBody(jsonMedia)
        val request = Request.Builder().url(baseUrl + "api/v1/auth/refresh").post(body).build()
        return try {
            authHttp.newCall(request).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                when {
                    resp.isSuccessful -> {
                        val tokens = json.decodeFromString(AuthTokensResponse.serializer(), text)
                        storeTokens(secureStorage, tokens)
                        RefreshOutcome.Refreshed(tokens.accessToken)
                    }
                    resp.code == 401 -> {
                        val code = runCatching { json.decodeFromString(ApiErrorResponse.serializer(), text).code }.getOrNull()
                        if (code != null && code in SESSION_ENDED_CODES) RefreshOutcome.Rejected(code) else RefreshOutcome.Unreachable
                    }
                    else -> RefreshOutcome.Unreachable
                }
            }
        } catch (e: IOException) {
            RefreshOutcome.Unreachable
        } catch (e: IllegalArgumentException) {
            // Malformed body from a proxy/captive portal: not proof the session ended.
            RefreshOutcome.Unreachable
        }
    }

    companion object {
        val SESSION_ENDED_CODES = setOf("session_invalid", "session_revoked", "refresh_token_reused")

        fun storeTokens(secureStorage: SecureStorage, tokens: AuthTokensResponse) {
            secureStorage.putString(TokenStorageKeys.ACCESS_TOKEN, tokens.accessToken)
            secureStorage.putString(TokenStorageKeys.REFRESH_TOKEN, tokens.refreshToken)
            secureStorage.putString(TokenStorageKeys.ACCOUNT_ID, tokens.accountId)
            secureStorage.putString(TokenStorageKeys.IS_GUEST, tokens.isGuest.toString())
            tokens.email?.let { secureStorage.putString(TokenStorageKeys.EMAIL, it) }
            secureStorage.remove(TokenStorageKeys.SESSION_EXPIRED)
            SessionEvents.clear()
        }
    }
}
