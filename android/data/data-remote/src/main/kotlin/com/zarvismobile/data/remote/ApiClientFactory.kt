package com.zarvismobile.data.remote

import com.zarvismobile.core.security.SecureStorage
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory

/**
 * Builds the [ZarvisApi] client. `baseUrl` points at the ZARVIS backend (never at an AI
 * provider or GitHub directly — see MASTER_SPEC.md §9 and ARCHITECTURE.md).
 *
 * It is deliberately a required parameter with no default: the only correct value depends
 * on the build (`BuildConfig.API_BASE_URL`, passed by `app`'s `di/AppModule`) — the local
 * dev backend in debug, `https://zarvismobile.com/` in release. A default here used to be
 * `http://10.0.2.2:3000/`, the *emulator's* alias for the host machine's loopback, which is
 * unroutable from a physical phone; making callers state the URL keeps that address from
 * silently reappearing on a real device. See `app/build.gradle.kts`.
 */
object ApiClientFactory {
    private val json = Json { ignoreUnknownKeys = true }

    fun create(secureStorage: SecureStorage, baseUrl: String): ZarvisApi {
        val loggingInterceptor = HttpLoggingInterceptor().apply {
            // BASIC only — never log request/response bodies, which may carry tokens or
            // conversation content. See SECURITY.md "Logging redaction".
            level = HttpLoggingInterceptor.Level.BASIC
        }
        val client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(secureStorage))
            .addInterceptor(loggingInterceptor)
            .authenticator(TokenAuthenticator(baseUrl, secureStorage))
            .build()

        val contentType = "application/json".toMediaType()
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(json.asConverterFactory(contentType))
            .build()
            .create(ZarvisApi::class.java)
    }
}
