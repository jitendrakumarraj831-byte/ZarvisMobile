package com.zarvismobile.app.di

import android.content.Context
import androidx.room.Room
import com.zarvismobile.agents.AndroidOrchestrator
import com.zarvismobile.app.voice.AndroidSpeechToTextEngine
import com.zarvismobile.app.voice.AndroidTextToSpeechEngine
import com.zarvismobile.core.common.voice.SpeechToTextEngine
import com.zarvismobile.core.common.voice.TextToSpeechEngine
import com.zarvismobile.core.security.AndroidPermissionPort
import com.zarvismobile.core.security.SecureStorage
import com.zarvismobile.core.tooling.ComposeConfirmationPort
import com.zarvismobile.data.local.ZarvisDatabase
import com.zarvismobile.data.local.prefs.AppPreferences
import com.zarvismobile.data.local.reminder.ReminderDao
import com.zarvismobile.data.remote.ApiClientFactory
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.data.repository.RemoteEntitlementPort
import com.zarvismobile.data.repository.RemoteUsagePort
import com.zarvismobile.data.repository.SessionRepository
import com.zarvismobile.domain.port.ConfirmationPort
import com.zarvismobile.domain.port.EntitlementPort
import com.zarvismobile.domain.port.PermissionPort
import com.zarvismobile.domain.port.UsagePort
import com.zarvismobile.domain.tooling.SkillRegistry
import com.zarvismobile.domain.tooling.ToolPipeline
import com.zarvismobile.skills.OnDeviceSkillRegistryFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * The app's composition root — see ARCHITECTURE.md. Every cross-module dependency is wired
 * here rather than scattered across modules, so the full object graph is readable in one
 * place. Individual modules expose plain, Hilt-agnostic classes; only `app` (and feature
 * ViewModels, which need `@HiltViewModel` to be constructor-injected from this graph) use
 * Hilt annotations.
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
    fun provideZarvisApi(secureStorage: SecureStorage): ZarvisApi = ApiClientFactory.create(secureStorage)

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

    @Provides
    @Singleton
    fun providePermissionPort(@ApplicationContext context: Context): PermissionPort = AndroidPermissionPort(context)

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
    fun provideOnDeviceSkillRegistry(reminderDao: ReminderDao): SkillRegistry =
        OnDeviceSkillRegistryFactory.create(reminderDao)

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
    fun provideAndroidOrchestrator(
        registry: SkillRegistry,
        pipeline: ToolPipeline,
        api: ZarvisApi,
    ): AndroidOrchestrator = AndroidOrchestrator(registry, pipeline, api)

    @Provides
    @Singleton
    fun provideSpeechToTextEngine(@ApplicationContext context: Context): SpeechToTextEngine =
        AndroidSpeechToTextEngine(context)

    @Provides
    @Singleton
    fun provideTextToSpeechEngine(@ApplicationContext context: Context): TextToSpeechEngine =
        AndroidTextToSpeechEngine(context)
}
