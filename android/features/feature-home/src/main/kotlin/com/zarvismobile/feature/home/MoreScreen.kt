package com.zarvismobile.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.Jewel
import com.zarvismobile.core.ui.components.JewelIcon
import com.zarvismobile.core.ui.components.QueenPageHeader
import com.zarvismobile.core.ui.components.SectionKicker
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.i18n.trf
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.GlassColors
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
            contentPadding = PaddingValues(ZarvisSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            item {
                QueenPageHeader(
                    title = tr(UiString.WORK_TITLE),
                    subtitle = tr(UiString.WORK_INTRO),
                    icon = ZarvisIcons.Briefcase,
                    jewel = Jewel.GOLD,
                    kicker = "ZARVIS",
                )
            }
            item { SectionKicker(text = tr(UiString.WORK_ON_THIS_PHONE), modifier = Modifier.padding(start = ZarvisSpacing.xs, top = ZarvisSpacing.xs)) }
            items(WorkCatalog.onThisPhone, key = { it.id }) { item ->
                WorkCard(
                    item = item,
                    summary = summaryFor(item, state),
                    onOpen = {
                        val screen = item.screen
                        val feature = item.featureId
                        if (screen != null) onOpenScreen(screen) else if (feature != null) onOpenFeature(feature)
                    },
                )
            }
            item { SectionKicker(text = tr(UiString.WORK_ON_THE_WEBSITE), modifier = Modifier.padding(start = ZarvisSpacing.xs, top = ZarvisSpacing.sm)) }
            items(WorkCatalog.websiteOnly, key = { it.id }) { item ->
                WorkCard(item = item, summary = null, onOpen = null)
            }
        }
    }
}

/** Each card wears its own jewel and icon, so the list reads at a glance (the title still says what it is). */
private fun lookFor(item: WorkItem): Pair<ImageVector, Jewel> = when (item.id) {
    "tasks" -> ZarvisIcons.Task to Jewel.SAPPHIRE
    "memory" -> ZarvisIcons.Memory to Jewel.ORCHID
    "usage" -> ZarvisIcons.Chart to Jewel.EMERALD
    "plans" -> ZarvisIcons.Plan to Jewel.GOLD
    "developer" -> ZarvisIcons.Code to Jewel.AMETHYST
    "phone" -> ZarvisIcons.Phone to Jewel.RUBY
    "research" -> ZarvisIcons.Search to Jewel.SAPPHIRE
    "creative" -> ZarvisIcons.Pen to Jewel.ORCHID
    "business" -> ZarvisIcons.Briefcase to Jewel.GOLD
    "files" -> ZarvisIcons.File to Jewel.EMERALD
    "settings" -> ZarvisIcons.Settings to Jewel.AMETHYST
    "agents" -> ZarvisIcons.Brain to Jewel.AMETHYST
    else -> ZarvisIcons.Globe to Jewel.SAPPHIRE
}

@Composable
private fun WorkCard(item: WorkItem, summary: String?, onOpen: (() -> Unit)?) {
    val (icon, jewel) = lookFor(item)
    // A website-only card is quieter: it has nothing to open here.
    GlassSurface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        tint = if (onOpen != null) GlassColors.surfaceTint else GlassColors.surfaceTint.copy(alpha = GlassColors.surfaceTint.alpha * 0.6f),
        contentPadding = 16.dp,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            JewelIcon(icon, jewel, size = 48.dp)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(tr(item.title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                StatusBadge(label = tr(item.availability.label), tone = item.availability.tone)
            }
        }
        Text(
            tr(item.body),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 10.dp),
        )
        if (summary != null) {
            // The live number, as a small gold-dotted line.
            Row(
                modifier = Modifier.padding(top = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(7.dp).background(ZarvisAccents.gold, CircleShape))
                Text(summary, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            }
        }
        if (onOpen != null) {
            Spacer(Modifier.size(12.dp))
            // Every card says "Open": a screen reader needs to hear which one.
            val description = trf(UiString.COMMON_OPEN_NAMED, tr(item.title))
            ZarvisPrimaryButton(
                text = tr(UiString.COMMON_OPEN),
                onClick = onOpen,
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = description },
            )
        }
    }
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
