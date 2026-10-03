package com.zarvismobile.data.remote

import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.UnknownHostException

/**
 * Replaces OkHttp's own silent retry (`retryOnConnectionFailure`, turned off in
 * [ApiClientFactory]). That retry also re-sends a POST after the connection dropped once the
 * request was already written — for /orchestrator/turn a second agent turn and AI call the
 * user never asked for, for /auth/guest a second account. This interceptor retries once only
 * when it is safe: an idempotent request (GET/HEAD), or a failure that proves nothing was
 * sent (the connection could not be opened). A 401 is unaffected: [TokenAuthenticator]'s
 * follow-up is a response follow-up, not a connection-failure retry.
 */
class SafeRetryInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        return try {
            chain.proceed(request)
        } catch (e: IOException) {
            val idempotent = request.method == "GET" || request.method == "HEAD"
            val nothingSent = e is ConnectException || e is UnknownHostException || e is NoRouteToHostException
            if (!(idempotent || nothingSent) || chain.call().isCanceled()) throw e
            chain.proceed(request)
        }
    }
}
