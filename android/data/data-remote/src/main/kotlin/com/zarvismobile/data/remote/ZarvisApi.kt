package com.zarvismobile.data.remote

import com.zarvismobile.data.remote.dto.AuthTokensResponse
import com.zarvismobile.data.remote.dto.ConfirmationResolutionResponse
import com.zarvismobile.data.remote.dto.ConversationMessagesResponse
import com.zarvismobile.data.remote.dto.IdentityResponse
import com.zarvismobile.data.remote.dto.CreateTaskRequest
import com.zarvismobile.data.remote.dto.DeveloperAnalyzeRequest
import com.zarvismobile.data.remote.dto.DeveloperAnalyzeResponse
import com.zarvismobile.data.remote.dto.EntitlementSnapshotResponse
import com.zarvismobile.data.remote.dto.LoginRequest
import com.zarvismobile.data.remote.dto.OrchestratorTurnRequest
import com.zarvismobile.data.remote.dto.OrchestratorTurnResponse
import com.zarvismobile.data.remote.dto.RefreshRequest
import com.zarvismobile.data.remote.dto.SignupRequest
import com.zarvismobile.data.remote.dto.SkillsResponse
import com.zarvismobile.data.remote.dto.TaskDto
import com.zarvismobile.data.remote.dto.TasksResponse
import com.zarvismobile.data.remote.dto.TtsSynthesizeRequest
import com.zarvismobile.data.remote.dto.UsageChargeRequest
import com.zarvismobile.data.remote.dto.UsageChargeResponse
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Streaming

/** Retrofit surface for the endpoints defined in MASTER_SPEC.md §25 / backend/src/api. */
interface ZarvisApi {
    @POST("api/v1/auth/signup")
    suspend fun signup(@Body request: SignupRequest): AuthTokensResponse

    @POST("api/v1/auth/login")
    suspend fun login(@Body request: LoginRequest): AuthTokensResponse

    @POST("api/v1/auth/refresh")
    suspend fun refresh(@Body request: RefreshRequest): AuthTokensResponse

    /** Server-created guest account; the client never chooses guest credentials. */
    @POST("api/v1/auth/guest")
    suspend fun createGuest(): AuthTokensResponse

    @GET("api/v1/auth/me")
    suspend fun me(): IdentityResponse

    /** Adds a sign-in email/password to the current guest account (same account id and data). */
    @POST("api/v1/auth/link")
    suspend fun linkAccount(@Body request: LoginRequest): IdentityResponse

    /** Revokes this device's session server-side. */
    @POST("api/v1/auth/logout")
    suspend fun logout(): Response<Unit>

    @GET("api/v1/conversations/{id}/messages")
    suspend fun conversationMessages(@Path("id") id: String): ConversationMessagesResponse

    @POST("api/v1/confirmations/{id}/approve")
    suspend fun approveConfirmation(@Path("id") id: String): ConfirmationResolutionResponse

    @POST("api/v1/confirmations/{id}/decline")
    suspend fun declineConfirmation(@Path("id") id: String): ConfirmationResolutionResponse

    /** Cascading account deletion — MASTER_SPEC.md §17 "Memory Architecture". */
    @DELETE("api/v1/account")
    suspend fun deleteAccount()

    @GET("api/v1/skills")
    suspend fun getSkills(): SkillsResponse

    @GET("api/v1/entitlements/me")
    suspend fun getEntitlements(): EntitlementSnapshotResponse

    @POST("api/v1/orchestrator/turn")
    suspend fun runTurn(@Body request: OrchestratorTurnRequest): OrchestratorTurnResponse

    @POST("api/v1/usage/charge")
    suspend fun chargeUsage(@Body request: UsageChargeRequest): UsageChargeResponse

    @GET("api/v1/tasks")
    suspend fun getTasks(): TasksResponse

    @POST("api/v1/tasks")
    suspend fun createTask(@Body request: CreateTaskRequest): TaskDto

    @POST("api/v1/tasks/{id}/{action}")
    suspend fun transitionTask(@Path("id") id: String, @Path("action") action: String): TaskDto

    @POST("api/v1/developer/analyze")
    suspend fun analyzeRepo(@Body request: DeveloperAnalyzeRequest): DeveloperAnalyzeResponse

    // Response<ResponseBody>, not a thrown exception on non-2xx: a 503 here (no
    // GEMINI_API_KEY configured server-side, see backend/src/api/routes/tts.ts) is an
    // expected, honestly-reported outcome the caller falls back from, not an error to catch.
    @Streaming
    @POST("api/v1/tts/synthesize")
    suspend fun synthesizeSpeech(@Body request: TtsSynthesizeRequest): Response<ResponseBody>
}
