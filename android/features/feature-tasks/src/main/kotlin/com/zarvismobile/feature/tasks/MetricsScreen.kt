package com.zarvismobile.feature.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.common.metrics.TurnMetric
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.ZarvisChip
import com.zarvismobile.core.ui.components.RiskBadge
import com.zarvismobile.core.ui.components.RiskBadgeLevel
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.i18n.LocalAppLocale
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.theme.GlowColors
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.data.remote.dto.TaskDto
import com.zarvismobile.domain.presentation.StatusLabels
import com.zarvismobile.domain.presentation.UiString
import kotlin.math.roundToLong

/**
 * System Metrics (MASTER_SPEC.md §22 "Live API Latency & Logs Drawer"): real, on-device
 * measured latency for every orchestrator turn this session, plus the current task log —
 * both already-available data, timed/read on the client only. No backend or API change.
 */
@Composable
fun MetricsScreen(onBack: (() -> Unit)? = null, viewModel: MetricsViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    val latencyLog by viewModel.latencyLog.collectAsState()
    val locale = LocalAppLocale.current

    val avgLatencyMs = if (latencyLog.isEmpty()) 0L else latencyLog.map { it.durationMs }.average().roundToLong()
    val successRatePercent = if (latencyLog.isEmpty()) 100 else (latencyLog.count { it.success } * 100 / latencyLog.size)
    // Counted by the words shown (the server's lifecycle when it sends one), so a chip and the rows under it never disagree.
    val statusCounts = uiState.tasks.groupingBy { StatusLabels.taskText(it.status, it.lifecycle, locale) }.eachCount()

    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(ZarvisSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            item {
                if (onBack != null) TextButton(onClick = onBack) { Text(tr(UiString.COMMON_BACK)) }
                Text(text = tr(UiString.METRICS_TITLE), style = MaterialTheme.typography.headlineMedium)
                Text(
                    text = tr(UiString.METRICS_SUBTITLE),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            item {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                    StatTile(label = tr(UiString.METRICS_AVG_LATENCY), value = if (latencyLog.isEmpty()) "—" else "${avgLatencyMs}ms", modifier = Modifier.weight(1f))
                    StatTile(label = tr(UiString.METRICS_TURNS), value = "${latencyLog.size}", modifier = Modifier.weight(1f))
                    StatTile(label = tr(UiString.METRICS_SUCCESS), value = if (latencyLog.isEmpty()) "—" else "$successRatePercent%", modifier = Modifier.weight(1f))
                }
            }

            item { Text(text = tr(UiString.METRICS_LIVE_LATENCY), style = MaterialTheme.typography.titleMedium) }

            if (latencyLog.isEmpty()) {
                item {
                    Text(
                        text = tr(UiString.METRICS_NO_TURNS),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                items(items = latencyLog, key = { it.id }) { metric -> LatencyRow(metric) }
            }

            item { Text(text = tr(UiString.METRICS_TASK_LOG), style = MaterialTheme.typography.titleMedium) }

            if (uiState.isLoading) {
                item { CircularProgressIndicator() }
            }
            if (uiState.error != null) {
                item {
                    Text(text = tr(UiString.METRICS_TASKS_ERROR), color = MaterialTheme.colorScheme.error)
                    ZarvisSecondaryButton(text = tr(UiString.COMMON_TRY_AGAIN), onClick = viewModel::refresh)
                }
            }
            if (statusCounts.isNotEmpty()) {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                        statusCounts.forEach { (label, count) -> ZarvisChip(label = "$label · $count", onClick = {}) }
                    }
                }
            }
            items(items = uiState.tasks.take(10), key = { it.id }) { task -> TaskLogRow(task) }

            item { Spacer(modifier = Modifier.size(ZarvisSpacing.xxl)) }
        }
    }
}

@Composable
private fun StatTile(label: String, value: String, modifier: Modifier = Modifier) {
    GlassSurface(modifier = modifier) {
        Text(text = value, style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary)
        Text(text = label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun LatencyRow(metric: TurnMetric) {
    val glow = if (metric.success) GlowColors.success else GlowColors.error
    GlassSurface(modifier = Modifier.fillMaxWidth(), contentPadding = ZarvisSpacing.sm) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = metric.label,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(modifier = Modifier.size(ZarvisSpacing.sm))
            Text(text = "${metric.durationMs}ms", style = MaterialTheme.typography.labelLarge, color = glow)
        }
    }
}

@Composable
private fun TaskLogRow(task: TaskDto) {
    val locale = LocalAppLocale.current
    GlassSurface(modifier = Modifier.fillMaxWidth(), contentPadding = ZarvisSpacing.sm) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = task.goal,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(modifier = Modifier.size(ZarvisSpacing.sm))
            Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.xs), verticalAlignment = Alignment.CenterVertically) {
                StatusBadge(label = StatusLabels.taskText(task.status, task.lifecycle, locale), tone = StatusLabels.taskTone(task.status, task.lifecycle))
                RiskBadgeLevel.fromWire(task.riskLevel)?.let { RiskBadge(level = it) }
            }
        }
    }
}
