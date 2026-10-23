package com.zarvismobile.feature.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.Jewel
import com.zarvismobile.core.ui.components.JewelIcon
import com.zarvismobile.core.ui.components.QueenEmptyState
import com.zarvismobile.core.ui.components.QueenErrorCard
import com.zarvismobile.core.ui.components.QueenPageHeader
import com.zarvismobile.core.ui.components.RiskBadge
import com.zarvismobile.core.ui.components.RiskBadgeLevel
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisChip
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.components.SkeletonList
import com.zarvismobile.core.ui.i18n.LocalAppLocale
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.data.remote.dto.TaskDto
import com.zarvismobile.domain.presentation.StatusLabels
import com.zarvismobile.domain.presentation.StatusTone
import com.zarvismobile.domain.presentation.UiString

/**
 * Task list + lifecycle controls — MASTER_SPEC.md §18 (Task Engine). It is the Activity tab, and also Work > Tasks (then
 * [onBack] is set and the title is "Tasks"). It sits on the same aurora page and header as Work and Capabilities, and the list scrolls
 * as one column: the header, notices and cards all move together, so nothing is pinned above a short list on a small screen.
 */
@Composable
fun TasksScreen(
    onOpenPlans: () -> Unit = {},
    onOpenTasksFeature: () -> Unit = {},
    onBack: (() -> Unit)? = null,
    viewModel: TasksViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    LifecycleResumeEffect(Unit) {
        viewModel.refresh()
        onPauseOrDispose { }
    }

    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(ZarvisSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            item {
                QueenPageHeader(
                    title = tr(if (onBack != null) UiString.TASKS_TITLE_WORK else UiString.TASKS_TITLE),
                    subtitle = tr(UiString.TASKS_SUBTITLE),
                    icon = ZarvisIcons.Activity,
                    jewel = Jewel.SAPPHIRE,
                    kicker = "ZARVIS",
                    onBack = onBack,
                    backLabel = tr(UiString.COMMON_BACK),
                    actions = {
                        ZarvisChip(label = tr(UiString.COMMON_PLANS_QUOTAS), onClick = onOpenPlans, icon = ZarvisIcons.Plan)
                        ZarvisChip(label = tr(UiString.TASKS_ABOUT), onClick = onOpenTasksFeature, icon = ZarvisIcons.Task)
                    },
                )
            }

            // The four states of the list (ANDROID_QUEEN_DESIGN.md, board A22): a gold skeleton while loading, the crown when empty,
            // a ruby card with Try again when it failed, and the tasks.
            if (uiState.isLoading && uiState.tasks.isEmpty()) {
                item { SkeletonList(loadingLabel = tr(UiString.COMMON_LOADING), rows = 4) }
            }

            if (uiState.tasks.isEmpty() && !uiState.isLoading && uiState.error == null) {
                item { QueenEmptyState(title = tr(UiString.TASKS_EMPTY_TITLE), body = tr(UiString.TASKS_EMPTY)) }
            }

            if (uiState.error != null) {
                // The list could not be loaded: say so and offer the retry here, instead of asking the user to leave and come back.
                item { QueenErrorCard(message = tr(UiString.TASKS_ERROR), retryLabel = tr(UiString.COMMON_TRY_AGAIN), onRetry = viewModel::refresh) }
            }
            if (uiState.actionFailed) {
                item { Text(text = tr(UiString.TASKS_ACTION_ERROR), color = MaterialTheme.colorScheme.error) }
            }

            items(uiState.tasks.distinctBy { it.id }, key = { it.id }) { task ->
                TaskRow(task = task, busy = task.id in uiState.busy, viewModel = viewModel)
            }
            item { Spacer(modifier = Modifier.size(ZarvisSpacing.xl)) }
        }
    }
}

@Composable
private fun TaskRow(task: TaskDto, busy: Boolean, viewModel: TasksViewModel) {
    val locale = LocalAppLocale.current
    val tone = StatusLabels.taskTone(task.status, task.lifecycle)
    val jewel = jewelFor(tone)
    GlassSurface(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp), contentPadding = 0.dp) {
        // A jewel stripe down the left edge in the status's colour, so a long list reads at a glance (the badge says it in words).
        Row(modifier = Modifier.height(IntrinsicSize.Min)) {
            Box(
                Modifier
                    .padding(vertical = 14.dp)
                    .width(4.dp)
                    .fillMaxHeight()
                    .background(jewel.bottom, RoundedCornerShape(topEnd = 4.dp, bottomEnd = 4.dp)),
            )
            Column(modifier = Modifier.weight(1f).padding(16.dp), verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    JewelIcon(ZarvisIcons.Task, jewel, size = 44.dp)
                    Text(text = task.goal, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
                }
                // Plain-language state and risk, never the raw codes (PENDING, LOW, ...).
                Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm), verticalAlignment = Alignment.CenterVertically) {
                    StatusBadge(label = StatusLabels.taskText(task.status, task.lifecycle, locale), tone = tone)
                    val risk = RiskBadgeLevel.fromWire(task.riskLevel)
                    if (risk != null) RiskBadge(level = risk) else Text(text = StatusLabels.riskText(task.riskLevel, locale), style = MaterialTheme.typography.labelMedium)
                }
                // Nothing runs a task by itself, and this screen has no Run / Retry control (the website does: POST /tasks/:id/run),
                // so it offers none: an old "Start" button used to show RUNNING while nothing ran.
                if (task.status == "PENDING" || task.status == "PAUSED" || task.status == "FAILED") {
                    Text(
                        text = tr(UiString.TASKS_NOT_AUTOMATIC),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                // Off while this task's Pause or Cancel is on its way.
                Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                    when (task.status) {
                        "PENDING", "PAUSED" -> ZarvisSecondaryButton(tr(UiString.TASKS_CANCEL), onClick = { viewModel.cancel(task.id) }, enabled = !busy)
                        "RUNNING" -> {
                            ZarvisSecondaryButton(tr(UiString.TASKS_PAUSE), onClick = { viewModel.pause(task.id) }, enabled = !busy)
                            ZarvisSecondaryButton(tr(UiString.TASKS_CANCEL), onClick = { viewModel.cancel(task.id) }, enabled = !busy)
                        }
                    }
                }
            }
        }
    }
}

/** The jewel behind a task's icon follows its status (the badge still says it in words). */
private fun jewelFor(tone: StatusTone): Jewel = when (tone) {
    StatusTone.ACTIVE -> Jewel.SAPPHIRE
    StatusTone.WAITING -> Jewel.GOLD
    StatusTone.SUCCESS -> Jewel.EMERALD
    StatusTone.PROBLEM -> Jewel.RUBY
    StatusTone.NEUTRAL -> Jewel.AMETHYST
}
