package com.zarvismobile.agents

import com.zarvismobile.core.tooling.ComposeConfirmationPort
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.domain.access.AccessCoordinator
import com.zarvismobile.domain.capability.CapabilityRegistry
import com.zarvismobile.domain.conversation.ActiveConversation
import com.zarvismobile.domain.conversation.ConversationIdStore
import com.zarvismobile.domain.tooling.SkillRegistry
import com.zarvismobile.domain.tooling.ToolPipeline
import java.lang.reflect.Proxy

/** A conversation id kept in memory, standing for the saved one. */
class InMemoryConversationId(var id: String? = null) : ConversationIdStore {
    override suspend fun get(): String? = id
    override suspend fun set(id: String?) {
        this.id = id
    }
}

/**
 * The real [AndroidOrchestrator] for tests that only talk to the Brain: everything the conversation path never calls (on-device permissions,
 * the tool pipeline's ports, the clock) is a stand-in that fails loudly if it is ever called, rather than quietly doing nothing.
 */
object OrchestratorFixture {
    inline fun <reified T : Any> unused(): T =
        Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, method, _ ->
            error("${T::class.java.simpleName}.${method.name} must not be called while talking to the Brain")
        } as T

    fun create(api: ZarvisApi, conversation: ActiveConversation): AndroidOrchestrator = AndroidOrchestrator(
        onDeviceRegistry = SkillRegistry(),
        onDevicePipeline = ToolPipeline(SkillRegistry(), unused(), unused(), unused(), ComposeConfirmationPort(), unused()),
        api = api,
        confirmationPort = ComposeConfirmationPort(),
        capabilities = CapabilityRegistry(emptyList()),
        access = AccessCoordinator(unused(), unused(), unused(), unused()),
        pendingActions = unused(),
        conversation = conversation,
        clock = unused(),
    )
}
