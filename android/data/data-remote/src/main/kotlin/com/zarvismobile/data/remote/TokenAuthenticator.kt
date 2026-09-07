package com.zarvismobile.data.remote

import com.zarvismobile.core.security.SecureStorage
import com.zarvismobile.data.remote.dto.AuthTokensResponse
import com.zarvismobile.data.remote.dto.RefreshRequest
import com.zarvismobile.data.remote.dto.SignupRequest
import java.util.UUID
import kotlinx.serialization.json.Json
import okhttp3.Authenticator
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route

/**
 * Refreshes an expired access token on a 401 and, if the refresh token itself is rejected
 * (this device's stored account no longer exists server-side — the same "Unknown user"
 * class of failure the web client's `apiFetch` self-heals from, see web/app.js), bootstraps
 * a brand-new guest session instead of leaving the app permanently stuck on 401. Without
 * this, `SessionRepository.ensureSession()` (data-repository module) only ever bootstraps
 * once per install — it returns immediately whenever an account id is already stored,
 * without checking that account still works — and nothing else ever refreshed the access
 * token at all, so this app would have hit exactly the 401s fixed on the web client, just
 * with no recovery path here yet.
 *
 * Implemented as an OkHttp [Authenticator] (called only on a 401, given the failed
 * [Response]) rather than folded into [AuthInterceptor], since retrying with a *new* token
 * needs that response to build the retried request from — an [okhttp3.Interceptor] can't
 * cleanly express "redo this with different credentials" the way `Authenticator` is built
 * for.
 *
 * Talks to the auth endpoints with a bare [OkHttpClient] rather than the [ZarvisApi]
 * Retrofit instance this authenticator is attached to — building that Retrofit client
 * requires this authenticator to already exist, so depending on it back would be circular.
 */
class TokenAuthenticator(
    private val baseUrl: String,
    private val secureStorage: SecureStorage,
) : Authenticator {
    private val json = Json { ignoreUnknownKeys = true }
    private val authHttp = OkHttpClient()
    private val jsonMedia = "application/json".toMediaType()

    override fun authenticate(route: Route?, response: Response): Request? {
        if (responseCount(response) >= 2) return null // already retried once for this call — give up rather than loop

        val newAccessToken = refreshOrBootstrap(response.request) ?: return null
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
     * Synchronized so concurrent 401s (several in-flight requests failing at once) refresh
     * or bootstrap only once, not once per request — the first caller through re-checks
     * whether the stored token already moved past the one the failing request used (another
     * thread got there first) and reuses it instead of hitting the network again, which
     * would otherwise risk minting a second guest account under concurrent failures.
     */
    @Synchronized
    private fun refreshOrBootstrap(failedRequest: Request): String? {
        val tokenOnFailedRequest = failedRequest.header("Authorization")?.removePrefix("Bearer ")
        val currentlyStored = secureStorage.getString(TokenStorageKeys.ACCESS_TOKEN)
        if (currentlyStored != null && currentlyStored != tokenOnFailedRequest) return currentlyStored

        refresh()?.let { return it }
        return bootstrapGuestSession()
    }

    private fun refresh(): String? {
        val refreshToken = secureStorage.getString(TokenStorageKeys.REFRESH_TOKEN) ?: return null
        val body = json.encodeToString(RefreshRequest.serializer(), RefreshRequest(refreshToken)).toRequestBody(jsonMedia)
        val request = Request.Builder().url(baseUrl + "api/v1/auth/refresh").post(body).build()
        return runCatching { execute(request) }.getOrNull()?.let { storeTokens(it); it.accessToken }
    }

    private fun bootstrapGuestSession(): String? {
        val deviceId = UUID.randomUUID().toString()
        val signup = SignupRequest(
            email = "guest-$deviceId@device.zarvismobile.local",
            password = UUID.randomUUID().toString(),
        )
        val body = json.encodeToString(SignupRequest.serializer(), signup).toRequestBody(jsonMedia)
        val request = Request.Builder().url(baseUrl + "api/v1/auth/signup").post(body).build()
        return runCatching { execute(request) }.getOrNull()?.let {
            secureStorage.clear()
            storeTokens(it)
            it.accessToken
        }
    }

    private fun execute(request: Request): AuthTokensResponse? {
        authHttp.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) return null
            val bodyText = resp.body?.string() ?: return null
            return json.decodeFromString(AuthTokensResponse.serializer(), bodyText)
        }
    }

    private fun storeTokens(tokens: AuthTokensResponse) {
        secureStorage.putString(TokenStorageKeys.ACCESS_TOKEN, tokens.accessToken)
        secureStorage.putString(TokenStorageKeys.REFRESH_TOKEN, tokens.refreshToken)
        secureStorage.putString(TokenStorageKeys.ACCOUNT_ID, tokens.accountId)
    }
}
