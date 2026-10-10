package com.zarvismobile.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisCard
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.i18n.trf
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
    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(ZarvisSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            item {
                Text(tr(UiString.WORK_TITLE), style = MaterialTheme.typography.headlineMedium)
                Text(
                    tr(UiString.WORK_INTRO),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
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
            item {
                Text(tr(UiString.WORK_ON_THE_WEBSITE), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
            }
            items(WorkCatalog.websiteOnly, key = { it.id }) { item ->
                WorkCard(item = item, summary = null, onOpen = null)
            }
        }
    }
}

@Composable
private fun WorkCard(item: WorkItem, summary: String?, onOpen: (() -> Unit)?) {
    ZarvisCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(tr(item.title), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            StatusBadge(label = tr(item.availability.label), tone = item.availability.tone)
        }
        Text(tr(item.body), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (summary != null) {
            Text(summary, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        }
        if (onOpen != null) {
            // Every card says "Open": a screen reader needs to hear which one.
            val description = trf(UiString.COMMON_OPEN_NAMED, tr(item.title))
            TextButton(onClick = onOpen, modifier = Modifier.semantics { contentDescription = description }) { Text(tr(UiString.COMMON_OPEN)) }
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
