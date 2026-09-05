package com.zarvismobile.core.common

import android.util.Log

/**
 * Central logging facade — mirrors backend/src/security/redact.ts. Every log call goes
 * through this instead of android.util.Log directly, so redaction is never optional.
 * See SECURITY.md "Logging redaction".
 */
private val SENSITIVE_KEY_PATTERN = Regex("password|otp|token|secret|authorization|cardnumber|cvv|pin", RegexOption.IGNORE_CASE)
private const val REDACTED = "[REDACTED]"

object ZarvisLogger {
    fun d(tag: String, message: String, data: Map<String, Any?> = emptyMap()) {
        Log.d(tag, format(message, data))
    }

    fun i(tag: String, message: String, data: Map<String, Any?> = emptyMap()) {
        Log.i(tag, format(message, data))
    }

    fun w(tag: String, message: String, data: Map<String, Any?> = emptyMap()) {
        Log.w(tag, format(message, data))
    }

    fun e(tag: String, message: String, throwable: Throwable? = null, data: Map<String, Any?> = emptyMap()) {
        Log.e(tag, format(message, data), throwable)
    }

    private fun format(message: String, data: Map<String, Any?>): String {
        if (data.isEmpty()) return message
        val redacted = data.entries.joinToString(", ") { (key, value) ->
            "$key=${if (SENSITIVE_KEY_PATTERN.containsMatchIn(key)) REDACTED else value}"
        }
        return "$message [$redacted]"
    }
}
