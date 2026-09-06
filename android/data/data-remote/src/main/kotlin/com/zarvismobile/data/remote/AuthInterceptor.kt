package com.zarvismobile.data.remote

import com.zarvismobile.core.security.SecureStorage
import okhttp3.Interceptor
import okhttp3.Response

private const val ACCESS_TOKEN_KEY = "access_token"

/** Attaches the stored access token to every request — see SecureStorage and MASTER_SPEC.md §15. */
class AuthInterceptor(private val secureStorage: SecureStorage) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = secureStorage.getString(ACCESS_TOKEN_KEY)
        val request = if (token != null) {
            // `.header(...)` (set/replace), not `.addHeader(...)` — a request retried by
            // [TokenAuthenticator] after a refresh already carries its own fresh
            // Authorization header before it reaches this interceptor again, and
            // `addHeader` would append a second one instead of replacing it.
            chain.request().newBuilder().header("Authorization", "Bearer $token").build()
        } else {
            chain.request()
        }
        return chain.proceed(request)
    }
}

object TokenStorageKeys {
    const val ACCESS_TOKEN = ACCESS_TOKEN_KEY
    const val REFRESH_TOKEN = "refresh_token"
    const val ACCOUNT_ID = "account_id"
}
