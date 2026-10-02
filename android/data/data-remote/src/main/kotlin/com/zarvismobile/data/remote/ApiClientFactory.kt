package com.zarvismobile.data.remote

import com.zarvismobile.core.security.SecretStore
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

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

    /**
     * OkHttp's default 10 s read timeout is shorter than a real agent turn (a web search plus
     * two model calls routinely takes longer), and POST /orchestrator/turn sends nothing until
     * the turn is done. The phone then reported "couldn't reach ZARVIS" while the server was
     * still working — and a Retry ran the whole turn a second time. Allow a full turn.
     */
    const val READ_TIMEOUT_SECONDS = 150L
    const val CONNECT_TIMEOUT_SECONDS = 15L
    const val CALL_TIMEOUT_SECONDS = 180L

    fun create(secureStorage: SecretStore, baseUrl: String): ZarvisApi {
        val client = httpClient(secureStorage, baseUrl)

        val contentType = "application/json".toMediaType()
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(json.asConverterFactory(contentType))
            .build()
            .create(ZarvisApi::class.java)
    }

    internal fun httpClient(secureStorage: SecretStore, baseUrl: String): OkHttpClient {
        val loggingInterceptor = HttpLoggingInterceptor().apply {
            // BASIC only — never log request/response bodies, which may carry tokens or
            // conversation content. See SECURITY.md "Logging redaction".
            level = HttpLoggingInterceptor.Level.BASIC
        }
        return OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(secureStorage))
            .addInterceptor(SafeRetryInterceptor())
            .addInterceptor(loggingInterceptor)
            .authenticator(TokenAuthenticator(baseUrl, secureStorage))
            .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            // OkHttp's own retry can re-send a POST that already reached the server (a second
            // turn); SafeRetryInterceptor retries only when that cannot happen.
            .retryOnConnectionFailure(false)
            .build()
    }
}
