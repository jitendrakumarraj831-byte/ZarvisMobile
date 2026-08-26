package com.jarvismobile.app.di

import android.content.Context
import androidx.room.Room
import com.jarvismobile.agents.AndroidOrchestrator
import com.jarvismobile.app.voice.AndroidSpeechToTextEngine
import com.jarvismobile.app.voice.AndroidTextToSpeechEngine
import com.jarvismobile.core.common.voice.SpeechToTextEngine
import com.jarvismobile.core.common.voice.TextToSpeechEngine
import com.jarvismobile.core.security.AndroidPermissionPort
import com.jarvismobile.core.security.SecureStorage
import com.jarvismobile.core.tooling.ComposeConfirmationPort
import com.jarvismobile.data.local.JarvisDatabase
import com.jarvismobile.data.local.prefs.AppPreferences
import com.jarvismobile.data.local.reminder.ReminderDao
import com.jarvismobile.data.remote.ApiClientFactory
import com.jarvismobile.data.remote.JarvisApi
import com.jarvismobile.data.repository.RemoteEntitlementPort
import com.jarvismobile.data.repository.RemoteUsagePort
import com.jarvismobile.data.repository.SessionRepository
import com.jarvismobile.domain.port.ConfirmationPort
import com.jarvismobile.domain.port.EntitlementPort
import com.jarvismobile.domain.port.PermissionPort
import com.jarvismobile.domain.port.UsagePort
import com.jarvismobile.domain.tooling.SkillRegistry
import com.jarvismobile.domain.tooling.ToolPipeline
import com.jarvismobile.skills.OnDeviceSkillRegistryFactory
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
    fun provideJarvisApi(secureStorage: SecureStorage): JarvisApi = ApiClientFactory.create(secureStorage)

    @Provides
    @Singleton
    fun provideSessionRepository(api: JarvisApi, secureStorage: SecureStorage): SessionRepository =
        SessionRepository(api, secureStorage)

    @Provides
    @Singleton
    fun provideJarvisDatabase(@ApplicationContext context: Context): JarvisDatabase =
        Room.databaseBuilder(context, JarvisDatabase::class.java, "jarvis.db").build()

    @Provides
    fun provideReminderDao(database: JarvisDatabase): ReminderDao = database.reminderDao()

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
    fun provideEntitlementPort(api: JarvisApi): EntitlementPort = RemoteEntitlementPort(api)

    @Provides
    @Singleton
    fun provideUsagePort(api: JarvisApi): UsagePort = RemoteUsagePort(api)

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
        api: JarvisApi,
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
