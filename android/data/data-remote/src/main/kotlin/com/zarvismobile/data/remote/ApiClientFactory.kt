package com.zarvismobile.data.remote

import com.zarvismobile.core.security.SecureStorage
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/**
 * Builds the [ZarvisApi] client. `baseUrl` points at the ZARVIS backend (never at an AI
 * provider or GitHub directly — see MASTER_SPEC.md §9 and ARCHITECTURE.md). Defaults to the
 * emulator-local dev backend; `app`'s `di/AppModule` passes `BuildConfig.API_BASE_URL`
 * instead, which resolves to the real deployed backend in a release build — see
 * `app/build.gradle.kts`.
 */
object ApiClientFactory {
    private val json = Json { ignoreUnknownKeys = true }

    fun create(secureStorage: SecureStorage, baseUrl: String = "http://10.0.2.2:3000/"): ZarvisApi {
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
