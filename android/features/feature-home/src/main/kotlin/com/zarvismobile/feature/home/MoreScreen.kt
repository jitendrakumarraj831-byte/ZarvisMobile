package com.zarvismobile.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.zarvismobile.core.ui.components.QueenListCard
import com.zarvismobile.core.ui.components.QueenPageHeader
import com.zarvismobile.core.ui.components.QueenRow
import com.zarvismobile.core.ui.components.QueenRowDivider
import com.zarvismobile.core.ui.components.QueenSection
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.i18n.trf
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.domain.presentation.StatusLabels
import com.zarvismobile.domain.presentation.UiString
import com.zarvismobile.domain.presentation.WorkCatalog
import com.zarvismobile.domain.presentation.WorkItem
import com.zarvismobile.domain.presentation.WorkScreen

/**
 * The Work tab. Every card is either a real screen of this app, a Chat page that says so, or labelled "Website only" with no
 * button (what is on this page is `WorkCatalog`, which has its own tests). Tasks, Memory and Plans show their live numbers.
 */
@Composable
fun MoreScreen(
    onOpenScreen: (WorkScreen) -> Unit,
    onOpenFeature: (String) -> Unit,
    viewModel: WorkViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    // Counts are read each time the tab is shown, so "Forget all" in Memory (or a task finished on the website) shows up on return.
    LifecycleResumeEffect(Unit) {
        viewModel.refresh()
        onPauseOrDispose { }
    }
    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(horizontal = ZarvisSpacing.md, vertical = ZarvisSpacing.md),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            item {
                QueenPageHeader(
                    title = tr(UiString.WORK_TITLE),
                    subtitle = tr(UiString.WORK_INTRO),
                )
            }
            item {
                QueenSection(title = tr(UiString.WORK_ON_THIS_PHONE)) {
                    QueenListCard {
                        WorkCatalog.onThisPhone.forEachIndexed { index, item ->
                            if (index > 0) QueenRowDivider()
                            WorkRow(
                                item = item,
                                summary = summaryFor(item, state),
                                onOpen = {
                                    val screen = item.screen
                                    val feature = item.featureId
                                    if (screen != null) onOpenScreen(screen) else if (feature != null) onOpenFeature(feature)
                                },
                            )
                        }
                    }
                }
            }
            item {
                QueenSection(title = tr(UiString.WORK_ON_THE_WEBSITE)) {
                    QueenListCard {
                        WorkCatalog.websiteOnly.forEachIndexed { index, item ->
                            if (index > 0) QueenRowDivider()
                            WorkRow(item = item, summary = null, onOpen = null)
                        }
                    }
                }
            }
            item { Spacer(Modifier.size(ZarvisSpacing.xl)) }
        }
    }
}

/** Each row wears its own icon and colour, so the list reads at a glance (the title still says what it is). */
@Composable
private fun lookFor(item: WorkItem): Pair<ImageVector, Color> = when (item.id) {
    "tasks" -> ZarvisIcons.Task to ZarvisAccents.cyan
    "memory" -> ZarvisIcons.Memory to ZarvisAccents.pink
    "usage" -> ZarvisIcons.Chart to ZarvisAccents.success
    "plans" -> ZarvisIcons.Plan to ZarvisAccents.gold
    "developer" -> ZarvisIcons.Code to ZarvisAccents.cyan
    "phone" -> ZarvisIcons.Phone to ZarvisAccents.cyan
    "research" -> ZarvisIcons.Search to ZarvisAccents.violet
    "creative" -> ZarvisIcons.Pen to ZarvisAccents.violet
    "business" -> ZarvisIcons.Briefcase to ZarvisAccents.violet
    "files" -> ZarvisIcons.File to ZarvisAccents.violet
    "settings" -> ZarvisIcons.Settings to ZarvisAccents.violet
    "agents" -> ZarvisIcons.Brain to ZarvisAccents.warning
    else -> ZarvisIcons.Globe to ZarvisAccents.warning
}

@Composable
private fun WorkRow(item: WorkItem, summary: String?, onOpen: (() -> Unit)?) {
    val (icon, tint) = lookFor(item)
    // Every row opens something: a screen reader (and the emulator tests) hear which one.
    val description = trf(UiString.COMMON_OPEN_NAMED, tr(item.title))
    QueenRow(
        title = tr(item.title),
        detail = tr(item.body),
        icon = icon,
        iconTint = tint,
        onClick = onOpen,
        modifier = if (onOpen != null) Modifier.semantics { contentDescription = description } else Modifier,
        trailing = { StatusBadge(label = tr(item.availability.label), tone = item.availability.tone) },
        below = summary?.let { line ->
            { Text(line, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = ZarvisAccents.primary) }
        },
    )
}

/** The live line under a card, or `null` when the card has none (or its number is still loading). */
@Composable
private fun summaryFor(item: WorkItem, state: WorkUiState): String? = when (item.screen) {
    WorkScreen.TASKS -> when (val tasks = state.taskCount) {
        Fetched.Loading -> null
        Fetched.Failed -> tr(UiString.WORK_SUMMARY_UNAVAILABLE)
        is Fetched.Ready -> if (tasks.value == 0) tr(UiString.WORK_SUMMARY_TASKS_NONE) else trf(UiString.WORK_SUMMARY_TASKS, tasks.value)
    }
    WorkScreen.MEMORY -> when (val memory = state.memory) {
        Fetched.Loading -> null
        Fetched.Failed -> tr(UiString.WORK_SUMMARY_UNAVAILABLE)
        is Fetched.Ready -> {
            val saved = memory.value.personal.size + memory.value.projects.sumOf { it.items.size }
            when {
                !memory.value.enabled -> tr(UiString.WORK_SUMMARY_MEMORY_PAUSED)
                saved == 0 -> tr(UiString.WORK_SUMMARY_MEMORY_NONE)
                else -> trf(UiString.WORK_SUMMARY_MEMORY, saved)
            }
        }
    }
    WorkScreen.PLANS -> when (val plan = state.plan) {
        Fetched.Loading -> null
        Fetched.Failed -> tr(UiString.WORK_SUMMARY_UNAVAILABLE)
        is Fetched.Ready -> trf(UiString.WORK_SUMMARY_PLAN, StatusLabels.humanize(plan.value.plan), plan.value.creditBalance)
    }
    else -> null
}
