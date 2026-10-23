package com.zarvismobile.data.remote

import com.zarvismobile.data.remote.dto.OrchestratorTurnResponse
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okio.BufferedSource

/**
 * One event of `POST /api/v1/orchestrator/turn-stream` (backend/src/api/routes/orchestrator.ts). The server sends an event only when
 * the turn really reaches that stage: the conversation is known, a planner step starts, a tool starts or finishes; the reply comes
 * once, in [Done].
 */
sealed interface TurnStreamEvent {
    data class Meta(val conversationId: String) : TurnStreamEvent

    /** Planner step [step] (1-based) started: the model is working out the answer. */
    data class Thinking(val step: Int) : TurnStreamEvent

    /** A tool started; [skillName] is its display name when the server gave one. */
    data class ToolStarted(val skillId: String, val skillName: String?) : TurnStreamEvent

    data class ToolFinished(val skillId: String, val status: String?) : TurnStreamEvent

    /** The finished turn, the same body as `POST /orchestrator/turn` answers. */
    data class Done(val response: OrchestratorTurnResponse) : TurnStreamEvent

    /** The turn failed; [body] is the error event's JSON (`{error, code?, retryable, ...}`), the same shape as the JSON route's error body. */
    data class Failed(val body: String) : TurnStreamEvent
}

/** Reads the turn stream's Server-Sent Events. Blocking: call it on an I/O thread. */
object TurnStreamReader {
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Reads events from [source], calling [onEvent] for each, until the turn ends ([TurnStreamEvent.Done] or [TurnStreamEvent.Failed],
     * which is returned) or the stream does (null: it ended before the answer).
     */
    fun read(source: BufferedSource, onEvent: (TurnStreamEvent) -> Unit = {}): TurnStreamEvent? {
        var name: String? = null
        val data = StringBuilder()
        while (true) {
            val line = source.readUtf8Line() ?: return null
            if (line.isEmpty()) {
                val event = if (data.isEmpty()) null else parse(name ?: "message", data.toString())
                name = null
                data.setLength(0)
                if (event != null) {
                    onEvent(event)
                    if (event is TurnStreamEvent.Done || event is TurnStreamEvent.Failed) return event
                }
                continue
            }
            if (line.startsWith(":")) continue // a comment (keep-alive)
            val field = line.substringBefore(':')
            val value = line.substringAfter(':', "").removePrefix(" ")
            when (field) {
                "event" -> name = value
                "data" -> {
                    if (data.isNotEmpty()) data.append('\n')
                    data.append(value)
                }
            }
        }
    }

    /** One event, or null for one this client does not use (a `delta`, a `tool_stage`) or cannot read. */
    fun parse(name: String, data: String): TurnStreamEvent? {
        if (name == "error") return TurnStreamEvent.Failed(data)
        val obj = runCatching { json.parseToJsonElement(data).jsonObject }.getOrNull() ?: return null
        return when (name) {
            "meta" -> obj.string("conversationId")?.let { TurnStreamEvent.Meta(it) }
            "done" -> runCatching { json.decodeFromString(OrchestratorTurnResponse.serializer(), data) }.getOrNull()?.let { TurnStreamEvent.Done(it) }
            "progress" -> when (obj.string("type")) {
                "thinking" -> TurnStreamEvent.Thinking(obj["step"]?.jsonPrimitive?.intOrNull ?: 1)
                "tool_started" -> obj.string("skillId")?.let { TurnStreamEvent.ToolStarted(it, obj.string("skillName")) }
                "tool_finished" -> obj.string("skillId")?.let { TurnStreamEvent.ToolFinished(it, obj.string("status")) }
                else -> null
            }
            else -> null
        }
    }

    private fun JsonObject.string(key: String): String? = runCatching { this[key]?.jsonPrimitive?.contentOrNull }.getOrNull()
}
