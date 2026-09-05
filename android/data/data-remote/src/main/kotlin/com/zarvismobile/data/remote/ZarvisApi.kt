package com.zarvismobile.data.remote

import com.zarvismobile.data.remote.dto.AuthTokensResponse
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
import com.zarvismobile.data.remote.dto.UsageChargeRequest
import com.zarvismobile.data.remote.dto.UsageChargeResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

/** Retrofit surface for the endpoints defined in MASTER_SPEC.md §25 / backend/src/api. */
interface ZarvisApi {
    @POST("api/v1/auth/signup")
    suspend fun signup(@Body request: SignupRequest): AuthTokensResponse

    @POST("api/v1/auth/login")
    suspend fun login(@Body request: LoginRequest): AuthTokensResponse

    @POST("api/v1/auth/refresh")
    suspend fun refresh(@Body request: RefreshRequest): AuthTokensResponse

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
}
