package com.zarvismobile.core.common.metrics

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** One client-measured orchestrator turn — feeds the System Metrics screen's live latency log. */
data class TurnMetric(
    val id: Long,
    val label: String,
    val durationMs: Long,
    val success: Boolean,
    val timestampMs: Long,
)

/**
 * In-memory, process-local log of how long each orchestrator turn took end-to-end, as measured
 * on-device around the existing `Orchestrator.handleTurn(...)` call. This is pure frontend
 * instrumentation — it does not call any new endpoint and does not change what the backend
 * does — it only times the request/response round-trip the app already performs, so the
 * System Metrics screen can show real "Live API Latency" numbers instead of inventing any.
 * Capped at [MAX_ENTRIES] so it never grows unbounded across a long session.
 */
object TurnMetricsStore {
    private const val MAX_ENTRIES = 50
    private var nextId = 0L

    private val _metrics = MutableStateFlow<List<TurnMetric>>(emptyList())
    val metrics: StateFlow<List<TurnMetric>> = _metrics.asStateFlow()

    fun record(label: String, durationMs: Long, success: Boolean) {
        _metrics.update { current ->
            val entry = TurnMetric(
                id = nextId++,
                label = label,
                durationMs = durationMs,
                success = success,
                timestampMs = System.currentTimeMillis(),
            )
            (listOf(entry) + current).take(MAX_ENTRIES)
        }
    }
}
