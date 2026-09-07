package com.zarvismobile.feature.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.theme.GlowColors
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.data.remote.dto.TaskDto
import kotlin.math.roundToLong

/**
 * System Metrics (MASTER_SPEC.md §22 "Live API Latency & Logs Drawer"): real, on-device
 * measured latency for every orchestrator turn this session, plus the current task log —
 * both already-available data, timed/read on the client only. No backend or API change.
 */
@Composable
fun MetricsScreen(viewModel: MetricsViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    val latencyLog by viewModel.latencyLog.collectAsState()

    val avgLatencyMs = if (latencyLog.isEmpty()) 0L else latencyLog.map { it.durationMs }.average().roundToLong()
    val successRatePercent = if (latencyLog.isEmpty()) 100 else (latencyLog.count { it.success } * 100 / latencyLog.size)
    val statusCounts = uiState.tasks.groupingBy { it.status }.eachCount()

    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(ZarvisSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            item {
                Text(text = "System Metrics", style = MaterialTheme.typography.headlineMedium)
                Text(
                    text = "Latency measured live on this device, and your current task log.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            item {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                    StatTile(label = "Avg Latency", value = if (latencyLog.isEmpty()) "—" else "${avgLatencyMs}ms", modifier = Modifier.weight(1f))
                    StatTile(label = "Turns Logged", value = "${latencyLog.size}", modifier = Modifier.weight(1f))
                    StatTile(label = "Success Rate", value = if (latencyLog.isEmpty()) "—" else "$successRatePercent%", modifier = Modifier.weight(1f))
                }
            }

            item { Text(text = "Live API Latency", style = MaterialTheme.typography.titleMedium) }

            if (latencyLog.isEmpty()) {
                item {
                    Text(
                        text = "No turns yet this session — ask ZARVIS something on Workspace and it shows up here instantly.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                items(items = latencyLog, key = { it.id }) { metric -> LatencyRow(metric) }
            }

            item { Text(text = "Task Log", style = MaterialTheme.typography.titleMedium) }

            if (uiState.isLoading) {
                item { CircularProgressIndicator() }
            }
            uiState.error?.let { error ->
                item { Text(text = error, color = MaterialTheme.colorScheme.error) }
            }
            if (statusCounts.isNotEmpty()) {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                        statusCounts.forEach { (status, count) -> ZarvisChip(label = "$status · $count", onClick = {}) }
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
    GlassSurface(modifier = Modifier.fillMaxWidth(), contentPadding = ZarvisSpacing.sm) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                text = task.goal,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            RiskBadge(level = RiskBadgeLevel.valueOf(task.riskLevel))
        }
    }
}
