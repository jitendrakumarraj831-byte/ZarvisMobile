package com.zarvismobile.feature.home

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.QueenErrorCard
import com.zarvismobile.core.ui.components.QueenFootnote
import com.zarvismobile.core.ui.components.QueenIconTile
import com.zarvismobile.core.ui.components.QueenListCard
import com.zarvismobile.core.ui.components.QueenOutlineAction
import com.zarvismobile.core.ui.components.QueenPageHeader
import com.zarvismobile.core.ui.components.QueenRow
import com.zarvismobile.core.ui.components.QueenRowDivider
import com.zarvismobile.core.ui.components.QueenSection
import com.zarvismobile.core.ui.components.RiskBadge
import com.zarvismobile.core.ui.components.RiskBadgeLevel
import com.zarvismobile.core.ui.components.SkeletonList
import com.zarvismobile.core.ui.components.StatusBadge
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisChip
import com.zarvismobile.core.ui.components.ZarvisFilterChip
import com.zarvismobile.core.ui.components.ZarvisSearchField
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.i18n.trf
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisProStyles
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.data.remote.dto.SkillDto
import com.zarvismobile.domain.capability.SharedFeatureCatalog
import com.zarvismobile.domain.entity.CapabilityStatus
import com.zarvismobile.domain.presentation.SkillFilter
import com.zarvismobile.domain.presentation.SkillPlace
import com.zarvismobile.domain.presentation.SkillRow
import com.zarvismobile.domain.presentation.SkillsCatalog
import com.zarvismobile.domain.presentation.StatusLabels
import com.zarvismobile.domain.presentation.StatusTone
import com.zarvismobile.domain.presentation.UiString

/**
 * The Skills tab (Queen Pro board 6): everything ZARVIS can do, in the shared catalogue's groups, each with how far it works on
 * this phone, then the server's skills you can run from Chat. A search and four filters (All, On this phone, In Chat, Website only)
 * narrow both; where a capability is used is read from the catalogue ([SkillsCatalog]), never decided here.
 */
@Composable
fun CapabilitiesScreen(
    onRunSkill: (initialText: String) -> Unit,
    onOpenFeature: (String) -> Unit = {},
    onOpenPlans: () -> Unit = {},
    viewModel: CapabilitiesViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    // Saveable: the search and the filter survive turning the phone and a visit to another tab.
    var query by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf(SkillFilter.ALL) }
    val groups = SkillsCatalog.groups(SharedFeatureCatalog.default, filter, query)
    // The server's skills are used by asking in Chat, so they belong to All and In Chat.
    val runnable = if (filter == SkillFilter.ALL || filter == SkillFilter.IN_CHAT) {
        uiState.skills.distinctBy { it.id }.filter { skillMatches(it, query) }
    } else {
        emptyList()
    }

    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        // One scrolling column: the header scrolls away with the list instead of holding a third of a small screen.
        LazyColumn(
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(horizontal = ZarvisSpacing.md, vertical = ZarvisSpacing.md),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            item {
                QueenPageHeader(
                    title = tr(UiString.CAPABILITIES_TITLE),
                    subtitle = tr(UiString.CAPABILITIES_INTRO),
                    actions = { ZarvisChip(label = tr(UiString.COMMON_PLANS_QUOTAS), onClick = onOpenPlans, icon = ZarvisIcons.Plan) },
                )
            }
            item { SkillSearch(query = query, onQueryChange = { query = it }) }
            item { SkillFilters(selected = filter, onSelect = { filter = it }) }

            items(groups, key = { "group-${it.title}" }) { group ->
                QueenSection(title = group.title) {
                    QueenListCard {
                        group.rows.forEachIndexed { index, row ->
                            if (index > 0) QueenRowDivider()
                            CapabilityRow(row = row, onOpen = row.detailPage?.let { page -> { onOpenFeature(page) } })
                        }
                    }
                }
            }

            when {
                filter != SkillFilter.ALL && filter != SkillFilter.IN_CHAT -> Unit
                uiState.isLoading -> item { SkeletonList(loadingLabel = tr(UiString.COMMON_LOADING), rows = 2) }
                uiState.error != null -> item {
                    QueenErrorCard(message = tr(UiString.CAPABILITIES_ERROR), retryLabel = tr(UiString.COMMON_TRY_AGAIN), onRetry = viewModel::refresh)
                }
                runnable.isNotEmpty() -> item {
                    QueenSection(title = tr(UiString.CAPABILITIES_SKILLS_NOW)) {
                        QueenListCard {
                            runnable.forEachIndexed { index, skill ->
                                if (index > 0) QueenRowDivider()
                                RunnableSkillRow(skill = skill, onRun = { onRunSkill("Use ${skill.name}") })
                            }
                        }
                    }
                }
            }

            if (groups.isEmpty() && runnable.isEmpty() && query.isNotBlank()) {
                item {
                    QueenListCard {
                        QueenRow(title = trf(UiString.SKILLS_NO_MATCH, query.trim()), icon = ZarvisIcons.Search, iconTint = ZarvisAccents.primary)
                    }
                }
            }
            item { QueenFootnote(text = tr(UiString.SKILLS_PARTIAL_NOTE)) }
            item { Spacer(modifier = Modifier.size(ZarvisSpacing.xl)) }
        }
    }
}

/** The search: the same raised glass pill as the Ask ZARVIS field, with the search icon in the theme's primary and Clear. */
@Composable
private fun SkillSearch(query: String, onQueryChange: (String) -> Unit) {
    ZarvisSearchField(query = query, onQueryChange = onQueryChange, placeholder = tr(UiString.SKILLS_SEARCH))
}

/** The four filters as one row of pills; the chosen one is filled with the theme's primary. One choice at a time, read out as radio buttons. */
@Composable
private fun SkillFilters(selected: SkillFilter, onSelect: (SkillFilter) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
    ) {
        SkillFilter.entries.forEach { option ->
            ZarvisFilterChip(label = tr(option.label), selected = option == selected, onClick = { onSelect(option) })
        }
    }
}

/**
 * The icon and accent of a capability on the Skills list, from the icon shared/feature-catalog.json gives it (the website's sprite
 * name, so both apps draw the same one); an icon this app does not know yet gets the sparkle. Decoration: the title says what it is.
 */
@Composable
private fun lookOf(catalogIcon: String): Pair<ImageVector, Color> = when (catalogIcon) {
    "i-chat" -> ZarvisIcons.Chat to ZarvisAccents.primary
    "i-globe" -> ZarvisIcons.Globe to ZarvisAccents.blue
    "i-search" -> ZarvisIcons.Search to ZarvisAccents.blue
    "i-folder" -> ZarvisIcons.Folder to ZarvisAccents.violet
    "i-file" -> ZarvisIcons.File to ZarvisAccents.cyan
    "i-memory" -> ZarvisIcons.Memory to ZarvisAccents.pink
    "i-mic" -> ZarvisIcons.Mic to ZarvisAccents.cyan
    "i-wave" -> ZarvisIcons.Wave to ZarvisAccents.violet
    "i-image" -> ZarvisIcons.Image to ZarvisAccents.cyan
    "i-task" -> ZarvisIcons.Task to ZarvisAccents.primary
    "i-activity" -> ZarvisIcons.Activity to ZarvisAccents.violet
    "i-phone" -> ZarvisIcons.Phone to ZarvisAccents.cyan
    "i-code" -> ZarvisIcons.Code to ZarvisAccents.blue
    "i-github" -> ZarvisIcons.Github to ZarvisAccents.violet
    "i-check" -> ZarvisIcons.Check to ZarvisAccents.success
    "i-pen" -> ZarvisIcons.Pen to ZarvisAccents.pink
    "i-briefcase" -> ZarvisIcons.Briefcase to ZarvisAccents.success
    else -> ZarvisIcons.Sparkle to ZarvisAccents.pink
}

/** A capability: its name, what it is and what it depends on, and how far it works on this phone (or that it is on the website). */
@Composable
private fun CapabilityRow(row: SkillRow, onOpen: (() -> Unit)?) {
    val capability = row.capability
    val (icon, tint) = lookOf(capability.icon)
    QueenRow(
        title = capability.name,
        detail = listOfNotNull(capability.short, capability.android.note).joinToString(" · "),
        icon = icon,
        iconTint = tint,
        onClick = onOpen,
        trailing = {
            if (row.place == SkillPlace.WEBSITE_ONLY) {
                StatusBadge(label = tr(UiString.WORK_AVAILABILITY_WEBSITE), tone = StatusTone.WAITING)
            } else {
                val tone = when (capability.android.status) {
                    CapabilityStatus.WORKING -> StatusTone.SUCCESS
                    CapabilityStatus.PARTIAL -> StatusTone.ACTIVE
                    CapabilityStatus.PLANNED, CapabilityStatus.UNSUPPORTED -> StatusTone.NEUTRAL
                }
                StatusBadge(label = tr(StatusLabels.capability(capability.android.status)), tone = tone)
            }
        },
    )
}

/** One of the server's skills: name, risk and what it does, with Run, which opens Chat with it asked for. */
@Composable
private fun RunnableSkillRow(skill: SkillDto, onRun: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = ZarvisSpacing.md, vertical = ZarvisSpacing.gap),
        horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.gap),
        verticalAlignment = Alignment.Top,
    ) {
        QueenIconTile(icon = ZarvisIcons.Bot, tint = ZarvisAccents.violet)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                Text(text = skill.name, style = ZarvisProStyles.rowTitle, modifier = Modifier.weight(1f))
                RiskBadgeLevel.fromWire(skill.riskLevel)?.let { RiskBadge(level = it) }
            }
            Text(
                text = skill.description,
                style = ZarvisProStyles.rowDetail,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
            QueenOutlineAction(label = tr(UiString.CAPABILITIES_RUN), onClick = onRun, icon = ZarvisIcons.Plane)
        }
    }
}

private fun skillMatches(skill: SkillDto, query: String): Boolean {
    val q = query.trim()
    return q.isEmpty() || skill.name.contains(q, ignoreCase = true) || skill.description.contains(q, ignoreCase = true)
}
