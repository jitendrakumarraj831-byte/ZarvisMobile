package com.zarvismobile.app.di

import android.content.Context
import androidx.room.Room
import com.zarvismobile.agents.AndroidOrchestrator
import com.zarvismobile.agents.ConversationIdStore
import com.zarvismobile.app.ActivityBridge
import com.zarvismobile.app.BuildConfig
import com.zarvismobile.app.voice.AndroidSpeechToTextEngine
import com.zarvismobile.app.voice.AndroidTextToSpeechEngine
import com.zarvismobile.core.common.voice.SpeechToTextEngine
import com.zarvismobile.core.common.voice.TextToSpeechEngine
import com.zarvismobile.core.security.AndroidDeviceAccessPort
import com.zarvismobile.core.security.AndroidPermissionPort
import com.zarvismobile.core.security.PermissionRequestLog
import com.zarvismobile.core.security.SecureStorage
import com.zarvismobile.core.tooling.ComposeConfirmationPort
import com.zarvismobile.core.tooling.ComposeRationalePort
import com.zarvismobile.data.local.ZarvisDatabase
import com.zarvismobile.data.local.access.DataStoreAccessSnapshotStore
import com.zarvismobile.data.local.access.DataStorePendingActionStore
import com.zarvismobile.data.local.prefs.AppPreferences
import com.zarvismobile.data.local.reminder.ReminderDao
import com.zarvismobile.data.remote.ApiClientFactory
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.repository.RemoteEntitlementPort
import com.zarvismobile.data.repository.RemoteUsagePort
import com.zarvismobile.data.repository.SessionRepository
import com.zarvismobile.domain.access.AccessCoordinator
import com.zarvismobile.domain.access.AppSettingsPort
import com.zarvismobile.domain.access.DeviceAccessPort
import com.zarvismobile.domain.access.PendingActionStore
import com.zarvismobile.domain.access.RevocationDetector
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.port.ConfirmationPort
import com.zarvismobile.domain.port.EntitlementPort
import com.zarvismobile.domain.port.PermissionPort
import com.zarvismobile.domain.port.SystemClockPort
import com.zarvismobile.domain.port.UsagePort
import com.zarvismobile.domain.tooling.SkillRegistry
import com.zarvismobile.domain.tooling.ToolPipeline
import com.zarvismobile.skills.ActivityPorts
import com.zarvismobile.skills.OnDeviceSkillRegistryFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton
import kotlinx.coroutines.flow.first

/**
 * The app's composition root. Every cross-module dependency is wired here so the full object
 * graph — including the Phase 1 permission-intelligence chain — is readable in one place.
 */
@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideSecureStorage(@ApplicationContext context: Context): SecureStorage = SecureStorage(context)

    @Provides
    @Singleton
    fun provideAppPreferences(@ApplicationContext context: Context): AppPreferences = AppPreferences(context)

    @Provides
    @Singleton
    fun provideZarvisApi(secureStorage: SecureStorage): ZarvisApi =
        ApiClientFactory.create(secureStorage, baseUrl = BuildConfig.API_BASE_URL)

    @Provides
    @Singleton
    fun provideSessionRepository(api: ZarvisApi, secureStorage: SecureStorage): SessionRepository =
        SessionRepository(api, secureStorage)

    @Provides
    @Singleton
    fun provideZarvisDatabase(@ApplicationContext context: Context): ZarvisDatabase =
        Room.databaseBuilder(context, ZarvisDatabase::class.java, "zarvis.db").build()

    @Provides
    fun provideReminderDao(database: ZarvisDatabase): ReminderDao = database.reminderDao()

    // --- Phase 1: capability registry + permission intelligence -------------------------

    @Provides
    @Singleton
    fun provideCapabilityRegistry(): CapabilityRegistry = CapabilityRegistry.loadDefault()

    @Provides
    @Singleton
    fun providePermissionRequestLog(@ApplicationContext context: Context): PermissionRequestLog =
        PermissionRequestLog(context).also(ActivityBridge::init)

    @Provides
    @Singleton
    fun provideDeviceAccessPort(@ApplicationContext context: Context, log: PermissionRequestLog): DeviceAccessPort =
        AndroidDeviceAccessPort(context, log) { ActivityBridge.currentActivity() }

    @Provides
    @Singleton
    fun providePermissionPort(device: DeviceAccessPort): PermissionPort = AndroidPermissionPort(device)

    @Provides
    @Singleton
    fun provideComposeRationalePort(): ComposeRationalePort = ComposeRationalePort()

    @Provides
    @Singleton
    fun provideAppSettingsPort(): AppSettingsPort = ActivityBridge

    @Provides
    @Singleton
    fun provideAccessCoordinator(
        device: DeviceAccessPort,
        rationale: ComposeRationalePort,
        settings: AppSettingsPort,
        // Ensures ActivityBridge knows the request log before any permission request.
        @Suppress("UNUSED_PARAMETER") log: PermissionRequestLog,
    ): AccessCoordinator = AccessCoordinator(device, rationale, ActivityBridge, settings)

    @Provides
    @Singleton
    fun provideRevocationDetector(@ApplicationContext context: Context, device: DeviceAccessPort): RevocationDetector =
        RevocationDetector(device, DataStoreAccessSnapshotStore(context))

    @Provides
    @Singleton
    fun providePendingActionStore(@ApplicationContext context: Context): PendingActionStore = DataStorePendingActionStore(context)

    // --- Tool pipeline + orchestration ----------------------------------------------------

    @Provides
    @Singleton
    fun provideComposeConfirmationPort(): ComposeConfirmationPort = ComposeConfirmationPort()

    @Provides
    @Singleton
    fun provideConfirmationPort(composeConfirmationPort: ComposeConfirmationPort): ConfirmationPort = composeConfirmationPort

    @Provides
    @Singleton
    fun provideEntitlementPort(api: ZarvisApi): EntitlementPort = RemoteEntitlementPort(api)

    @Provides
    @Singleton
    fun provideUsagePort(api: ZarvisApi): UsagePort = RemoteUsagePort(api)

    @Provides
    @Singleton
    fun provideOnDeviceSkillRegistry(reminderDao: ReminderDao, @ApplicationContext context: Context): SkillRegistry =
        OnDeviceSkillRegistryFactory.create(
            reminderDao,
            context,
            ActivityPorts(documents = ActivityBridge, photos = ActivityBridge, camera = ActivityBridge),
        )

    @Provides
    @Singleton
    fun provideOnDeviceToolPipeline(
        registry: SkillRegistry,
        permissionPort: PermissionPort,
        entitlementPort: EntitlementPort,
        usagePort: UsagePort,
        confirmationPort: ConfirmationPort,
    ): ToolPipeline = ToolPipeline(registry, permissionPort, entitlementPort, usagePort, confirmationPort)

    @Provides
    @Singleton
    fun provideConversationIdStore(preferences: AppPreferences): ConversationIdStore = object : ConversationIdStore {
        override suspend fun get(): String? = preferences.conversationId.first()
        override suspend fun set(id: String?) = preferences.setConversationId(id)
    }

    @Provides
    @Singleton
    fun provideAndroidOrchestrator(
        registry: SkillRegistry,
        pipeline: ToolPipeline,
        api: ZarvisApi,
        confirmationPort: ComposeConfirmationPort,
        capabilities: CapabilityRegistry,
        access: AccessCoordinator,
        pendingActions: PendingActionStore,
        conversations: ConversationIdStore,
    ): AndroidOrchestrator = AndroidOrchestrator(
        onDeviceRegistry = registry,
        onDevicePipeline = pipeline,
        api = api,
        confirmationPort = confirmationPort,
        capabilities = capabilities,
        access = access,
        pendingActions = pendingActions,
        conversations = conversations,
        clock = SystemClockPort,
    )

    // --- Voice ------------------------------------------------------------------------------

    @Provides
    @Singleton
    fun provideSpeechToTextEngine(@ApplicationContext context: Context): SpeechToTextEngine =
        AndroidSpeechToTextEngine(context)

    @Provides
    @Singleton
    fun provideTextToSpeechEngine(
        @ApplicationContext context: Context,
        api: ZarvisApi,
        preferences: AppPreferences,
    ): TextToSpeechEngine = AndroidTextToSpeechEngine(context, api, preferences)
}
