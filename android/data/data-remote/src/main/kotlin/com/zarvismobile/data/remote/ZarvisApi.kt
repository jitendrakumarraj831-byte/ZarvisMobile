package com.zarvismobile.data.remote

import com.zarvismobile.data.remote.dto.AuthTokensResponse
import com.zarvismobile.data.remote.dto.ConfirmationResolutionResponse
import com.zarvismobile.data.remote.dto.ConversationMessagesResponse
import com.zarvismobile.data.remote.dto.IdentityResponse
import com.zarvismobile.data.remote.dto.CreateNoteRequest
import com.zarvismobile.data.remote.dto.CreateTaskRequest
import com.zarvismobile.data.remote.dto.DeveloperAnalyzeRequest
import com.zarvismobile.data.remote.dto.DeviceActionResultRequest
import com.zarvismobile.data.remote.dto.DeviceResultResponse
import com.zarvismobile.data.remote.dto.DeveloperAnalyzeResponse
import com.zarvismobile.data.remote.dto.DocumentExtractResponse
import com.zarvismobile.data.remote.dto.EntitlementSnapshotResponse
import com.zarvismobile.data.remote.dto.LoginRequest
import com.zarvismobile.data.remote.dto.MemoryForgetResponse
import com.zarvismobile.data.remote.dto.MemoryNoteDto
import com.zarvismobile.data.remote.dto.MemoryOverviewResponse
import com.zarvismobile.data.remote.dto.MemorySettingsRequest
import com.zarvismobile.data.remote.dto.MemorySettingsResponse
import com.zarvismobile.data.remote.dto.OrchestratorTurnRequest
import com.zarvismobile.data.remote.dto.OrchestratorTurnResponse
import com.zarvismobile.data.remote.dto.RefreshRequest
import com.zarvismobile.data.remote.dto.SignupRequest
import com.zarvismobile.data.remote.dto.SkillsResponse
import com.zarvismobile.data.remote.dto.TaskDto
import com.zarvismobile.data.remote.dto.TasksResponse
import com.zarvismobile.data.remote.dto.TtsSynthesizeRequest
import com.zarvismobile.data.remote.dto.UpdateNoteRequest
import com.zarvismobile.data.remote.dto.UsageChargeRequest
import com.zarvismobile.data.remote.dto.UsageChargeResponse
import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
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

    /**
     * Deletes one of this account's chats for good (backend/src/api/routes/conversations.ts). The server answers 204, or 404 with the code
     * `conversation_not_found` when that chat does not exist (a server without this route also answers 404, but without that code).
     */
    @DELETE("api/v1/conversations/{id}")
    suspend fun deleteConversation(@Path("id") id: String)

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

    /**
     * The same turn as Server-Sent Events, read with [TurnStreamReader]: the conversation, each planner step and tool as it happens,
     * then the reply (`done`) or the error (`error`). A request the server refuses before the stream starts (401, 429, 400) is an
     * HttpException, as with [runTurn].
     */
    @Streaming
    @POST("api/v1/orchestrator/turn-stream")
    suspend fun runTurnStream(@Body request: OrchestratorTurnRequest): ResponseBody

    /** Records what a phone action the Brain handed over did, as the turn's reply in the conversation (and plans its next step). */
    @POST("api/v1/orchestrator/device-result")
    suspend fun reportDeviceResult(@Body request: DeviceActionResultRequest): Response<DeviceResultResponse>

    @POST("api/v1/usage/charge")
    suspend fun chargeUsage(@Body request: UsageChargeRequest): UsageChargeResponse

    @GET("api/v1/tasks")
    suspend fun getTasks(): TasksResponse

    @POST("api/v1/tasks")
    suspend fun createTask(@Body request: CreateTaskRequest): TaskDto

    @POST("api/v1/tasks/{id}/{action}")
    suspend fun transitionTask(@Path("id") id: String, @Path("action") action: String): TaskDto

    /** What ZARVIS remembers (backend/src/api/routes/notes.ts memoryRouter): only what the user saved, never automatic. */
    @GET("api/v1/memory")
    suspend fun getMemory(): MemoryOverviewResponse

    /** Pauses or resumes giving saved memory to the model. Saved items are kept either way. */
    @PUT("api/v1/memory/settings")
    suspend fun setMemoryEnabled(@Body request: MemorySettingsRequest): MemorySettingsResponse

    /** Forgets every personal memory item (project memory is untouched). */
    @DELETE("api/v1/memory/personal")
    suspend fun forgetPersonalMemory(): MemoryForgetResponse

    /** Deletes one note, personal or in a project. The server answers 204. */
    @DELETE("api/v1/notes/{id}")
    suspend fun deleteNote(@Path("id") id: String)

    /**
     * Saves one item the user typed into their personal memory (backend/src/api/routes/notes.ts, `kind: "memory"`, no project). The
     * server answers 201 with the saved note; 400 for empty or over-long text, 409 `limit_reached` when the account holds 500 notes.
     */
    @POST("api/v1/notes")
    suspend fun createNote(@Body request: CreateNoteRequest): MemoryNoteDto

    /** Pauses or resumes one memory item: a paused item stays saved but is not given to the model. Answers with the updated note. */
    @PATCH("api/v1/notes/{id}")
    suspend fun updateNote(@Path("id") id: String, @Body request: UpdateNoteRequest): MemoryNoteDto

    @POST("api/v1/developer/analyze")
    suspend fun analyzeRepo(@Body request: DeveloperAnalyzeRequest): DeveloperAnalyzeResponse

    // Response<ResponseBody>, not a thrown exception on non-2xx: a 503 (or other non-2xx)
    // is an honestly-reported server voice failure. AndroidTextToSpeechEngine then tries the
    // phone's installed TTS engine and surfaces an error only if that fallback also fails.
    @Streaming
    @POST("api/v1/tts/synthesize")
    suspend fun synthesizeSpeech(@Body request: TtsSynthesizeRequest): Response<ResponseBody>

    /**
     * Reads one uploaded file on the server and answers with its text. For an image the server's vision
     * model describes it (HTTP 503 `image_analysis_unavailable` when no configured model can). The file is
     * not stored. The caller reads the status itself, so a refusal is a [Response], not an exception.
     */
    @Multipart
    @POST("api/v1/documents/extract")
    suspend fun extractDocument(@Part file: MultipartBody.Part): Response<DocumentExtractResponse>
}
