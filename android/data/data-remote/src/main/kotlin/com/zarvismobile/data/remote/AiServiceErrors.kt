package com.zarvismobile.data.remote

import com.zarvismobile.data.remote.dto.ApiErrorResponse
import kotlinx.serialization.json.Json

/**
 * The server reports an exhausted AI quota or a rate limit as a structured error (backend
 * ai/geminiErrors.ts): HTTP 429 with `code` AI_QUOTA_EXCEEDED / AI_RATE_LIMITED, or the
 * per-account limiter's `rate_limited`. That is not a connectivity problem, so the user must
 * not be told to check their connection — and an exhausted daily quota is not worth retrying.
 */
object AiServiceErrors {
    private val json = Json { ignoreUnknownKeys = true }

    data class AiServiceError(val message: String, val retryable: Boolean)

    /** The structured AI-service error behind a failed response, or null when it is not one. */
    fun classify(status: Int, body: String?): AiServiceError? {
        if (status != 429 && status != 503) return null
        val code = body?.let { runCatching { json.decodeFromString(ApiErrorResponse.serializer(), it).code }.getOrNull() }
        return when (code) {
            "AI_QUOTA_EXCEEDED" -> AiServiceError(
                "ZARVIS has reached today's AI usage limit, so this request was not completed. Nothing was charged. Please try again later.",
                retryable = false,
            )
            "AI_RATE_LIMITED", "rate_limited" -> AiServiceError(
                "ZARVIS is getting too many requests right now. Nothing was charged. Please wait a moment and try again.",
                retryable = true,
            )
            "AI_UNAVAILABLE" -> AiServiceError(
                "The AI service is temporarily unavailable, so this request was not completed. Nothing was charged. Please try again.",
                retryable = true,
            )
            else -> null
        }
    }
}
