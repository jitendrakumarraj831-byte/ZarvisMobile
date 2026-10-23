package com.zarvismobile.domain.policy

import java.time.Instant
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put

/** Whether the user has paused every phone action (Settings › Phone action safety). */
fun interface AutomationSwitch {
    suspend fun isPaused(): Boolean

    companion object {
        val NEVER_PAUSED = AutomationSwitch { false }
    }
}

/** The pause setting as stored on the phone: what Settings shows and changes. */
interface AutomationPauseStore : AutomationSwitch {
    val paused: Flow<Boolean>
    suspend fun setPaused(paused: Boolean)
    override suspend fun isPaused(): Boolean = paused.first()
}

/** How one phone action ended, as the history shows it. */
enum class AutomationOutcome {
    /** It ran and its result was checked. */
    DONE,

    /** ZARVIS handed off to an app or system screen; the user finishes there (e.g. saves the alarm). */
    YOUR_TURN,

    /** The user did not confirm it. */
    DECLINED,

    /** The safety policy refused it (a sensitive app, a blocked button, an action not in the policy). */
    REFUSED,

    /** Phone actions were paused, so it did not run. */
    PAUSED,

    /** An Android permission or special access it needs is off. */
    NEEDS_ACCESS,

    /** It was tried and did not complete. */
    FAILED,
}

/** One phone action ZARVIS was asked to run: when, which action, what exactly (as it was described before running), and how it ended. */
data class AutomationRecord(
    val at: Instant,
    val skillId: String,
    val action: String,
    val outcome: AutomationOutcome,
)

/** Receives a record of every phone action attempt. It never fails the action it records. */
fun interface AutomationJournal {
    suspend fun record(entry: AutomationRecord)

    companion object {
        val NONE = AutomationJournal { }
    }
}

/**
 * The phone's history of phone actions (Settings › Phone action safety): newest first, at most [AutomationHistory.LIMIT] entries,
 * kept only on this phone and never uploaded. Cleared by the user, and when the account on the phone changes.
 */
interface AutomationHistoryStore : AutomationJournal {
    val entries: Flow<List<AutomationRecord>>
    suspend fun clear()
}

/** The history's bounded list and its storage format, kept here so the Android store only reads and writes one string. */
object AutomationHistory {
    const val LIMIT = 100

    /** Bounds each stored description: the history needs what was done, not a whole screen of text. */
    const val MAX_ACTION_CHARS = 300

    fun append(entries: List<AutomationRecord>, entry: AutomationRecord): List<AutomationRecord> =
        (listOf(entry.copy(action = entry.action.take(MAX_ACTION_CHARS))) + entries).take(LIMIT)

    fun encode(entries: List<AutomationRecord>): String = buildJsonArray {
        entries.forEach { e ->
            add(
                buildJsonObject {
                    put("at", e.at.toEpochMilli())
                    put("skillId", e.skillId)
                    put("action", e.action)
                    put("outcome", e.outcome.name)
                },
            )
        }
    }.toString()

    /** Unreadable or unknown entries are skipped; an unreadable store reads as empty rather than failing Settings. */
    fun decode(text: String?): List<AutomationRecord> {
        if (text.isNullOrBlank()) return emptyList()
        val array = runCatching { Json.parseToJsonElement(text) as? JsonArray }.getOrNull() ?: return emptyList()
        return array.mapNotNull { element ->
            runCatching {
                val o = element.jsonObject
                AutomationRecord(
                    at = Instant.ofEpochMilli(o.getValue("at").jsonPrimitive.long),
                    skillId = o.getValue("skillId").jsonPrimitive.content,
                    action = o.getValue("action").jsonPrimitive.content,
                    outcome = AutomationOutcome.valueOf(o.getValue("outcome").jsonPrimitive.content),
                )
            }.getOrNull()
        }.take(LIMIT)
    }
}
