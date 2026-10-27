package com.zarvismobile.feature.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.style.TextOverflow
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.common.metrics.TurnMetric
import com.zarvismobile.core.ui.components.GlassSurface
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.graphics.Color
import com.zarvismobile.core.ui.components.QueenListCard
import com.zarvismobile.core.ui.components.QueenRowDivider
import com.zarvismobile.core.ui.components.GoldMeter
import com.zarvismobile.core.ui.components.QueenPageHeader
import com.zarvismobile.core.ui.components.QueenStatTile
import com.zarvismobile.core.ui.components.SectionKicker
import com.zarvismobile.core.ui.components.ZarvisChip
import com.zarvismobile.core.ui.components.RiskBadge
import com.zarvismobile.core.ui.components.RiskBadgeLevel
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.QueenErrorCard
import com.zarvismobile.core.ui.components.SkeletonList
import com.zarvismobile.core.ui.i18n.LocalAppLocale
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.data.remote.dto.TaskDto
import com.zarvismobile.domain.presentation.StatusLabels
import com.zarvismobile.domain.presentation.UiString
import java.util.Locale
import kotlin.math.roundToLong

/**
 * System Metrics (MASTER_SPEC.md §22 "Live API Latency & Logs Drawer"): real, on-device
 * measured latency for every orchestrator turn this session, plus the current task log —
 * both already-available data, timed/read on the client only. No backend or API change.
 */
@OptIn(ExperimentalLayoutApi::class)
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
            contentPadding = PaddingValues(ZarvisSpacing.md),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            item {
                QueenPageHeader(
                    title = tr(UiString.METRICS_TITLE),
                    subtitle = tr(UiString.METRICS_SUBTITLE),
                    onBack = onBack,
                    backLabel = tr(UiString.COMMON_BACK),
                )
            }

            item {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                    QueenStatTile(
                        value = if (latencyLog.isEmpty()) "—" else formatLatency(avgLatencyMs),
                        label = tr(UiString.METRICS_AVG_LATENCY),
                        modifier = Modifier.weight(1f),
                    )
                    QueenStatTile(
                        value = "${latencyLog.size}",
                        label = tr(UiString.METRICS_TURNS),
                        modifier = Modifier.weight(1f),
                    )
                    QueenStatTile(
                        value = if (latencyLog.isEmpty()) "—" else "$successRatePercent%",
                        label = tr(UiString.METRICS_SUCCESS),
                        valueColor = if (latencyLog.isEmpty()) Color.Unspecified else ZarvisAccents.success,
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            if (latencyLog.isNotEmpty()) {
                item {
                    GlassSurface(modifier = Modifier.fillMaxWidth()) {
                        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(tr(UiString.METRICS_SUCCESS), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                            Text("$successRatePercent%", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.ExtraBold)
                        }
                        GoldMeter(fraction = successRatePercent / 100f, modifier = Modifier.padding(top = 10.dp))
                    }
                }
            }

            item { SectionKicker(text = tr(UiString.METRICS_LIVE_LATENCY), modifier = Modifier.padding(start = ZarvisSpacing.xs, top = ZarvisSpacing.xs)) }

            if (latencyLog.isEmpty()) {
                item {
                    Text(
                        text = tr(UiString.METRICS_NO_TURNS),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                // Each bar is the turn's time against the slowest one shown, so a slow reply stands out at a glance.
                val slowest = latencyLog.maxOf { it.durationMs }.coerceAtLeast(1L)
                item {
                    QueenListCard {
                        latencyLog.forEachIndexed { index, metric ->
                            if (index > 0) QueenRowDivider()
                            LatencyRow(metric, slowest)
                        }
                    }
                }
            }

            item { SectionKicker(text = tr(UiString.METRICS_TASK_LOG), modifier = Modifier.padding(start = ZarvisSpacing.xs, top = ZarvisSpacing.xs)) }

            if (uiState.isLoading) {
                item { SkeletonList(loadingLabel = tr(UiString.COMMON_LOADING), rows = 2) }
            }
            if (uiState.error != null) {
                item { QueenErrorCard(message = tr(UiString.METRICS_TASKS_ERROR), retryLabel = tr(UiString.COMMON_TRY_AGAIN), onRetry = viewModel::refresh) }
            }
            if (statusCounts.isNotEmpty()) {
                item {
                    // Wrapped, so four statuses (longer in Hindi) never squeeze each other on a narrow phone.
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm), verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                        statusCounts.forEach { (label, count) -> ZarvisChip(label = "$label · $count", onClick = null) }
                    }
                }
            }
            if (uiState.tasks.isNotEmpty()) {
                item {
                    QueenListCard {
                        uiState.tasks.take(10).forEachIndexed { index, task ->
                            if (index > 0) QueenRowDivider()
                            TaskLogRow(task)
                        }
                    }
                }
            }

            item { Spacer(modifier = Modifier.size(ZarvisSpacing.xxl)) }
        }
    }
}

/** "850 ms" under a second, "1.2 s" above: short enough for a third of a 360dp screen. */
private fun formatLatency(ms: Long): String = if (ms < 1_000) "$ms ms" else String.format(Locale.US, "%.1f s", ms / 1_000.0)

@Composable
private fun LatencyRow(metric: TurnMetric, slowest: Long) {
    // Text colour, so the theme's readable green and red, not the bright dark-page glows (1.8:1 on the light page).
    val glow = if (metric.success) ZarvisAccents.success else ZarvisAccents.danger
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = ZarvisSpacing.md, vertical = 12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = metric.label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(modifier = Modifier.size(ZarvisSpacing.sm))
            Text(text = formatLatency(metric.durationMs), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = glow)
        }
        GoldMeter(fraction = metric.durationMs.toFloat() / slowest, modifier = Modifier.padding(top = 8.dp), height = 6.dp)
    }
}

@Composable
private fun TaskLogRow(task: TaskDto) {
    val locale = LocalAppLocale.current
    Column(modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = ZarvisSpacing.md, vertical = 10.dp)) {
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
