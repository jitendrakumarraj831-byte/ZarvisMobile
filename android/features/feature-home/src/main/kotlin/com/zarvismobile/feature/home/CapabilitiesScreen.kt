package com.zarvismobile.feature.home

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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.font.FontWeight
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.Jewel
import com.zarvismobile.core.ui.components.JewelIcon
import com.zarvismobile.core.ui.components.QueenPageHeader
import com.zarvismobile.core.ui.components.SectionKicker
import com.zarvismobile.core.ui.components.ZarvisChip
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.domain.presentation.StatusLabels
import com.zarvismobile.domain.presentation.UiString
import com.zarvismobile.core.ui.components.RiskBadge
import com.zarvismobile.core.ui.components.RiskBadgeLevel
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.QueenErrorCard
import com.zarvismobile.core.ui.components.SkeletonList
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.data.remote.dto.SkillDto

/**
 * The Capabilities Hub (MASTER_SPEC.md §22): every skill ZARVIS currently has, shown as a
 * showcase card grouped by category with a direct "Run Agent" trigger that jumps straight
 * into Conversation/Workspace with that skill pre-armed — no menu hunting.
 */
@Composable
fun CapabilitiesScreen(
    onRunSkill: (initialText: String) -> Unit,
    onOpenFeature: (String) -> Unit = {},
    onOpenPlans: () -> Unit = {},
    viewModel: CapabilitiesViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        // One scrolling column: the header scrolls away with the list instead of holding a third of a small screen.
        LazyColumn(
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(ZarvisSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            item {
                QueenPageHeader(
                    title = tr(UiString.CAPABILITIES_TITLE),
                    subtitle = tr(UiString.CAPABILITIES_INTRO),
                    icon = ZarvisIcons.Grid,
                    jewel = Jewel.AMETHYST,
                    kicker = tr(UiString.CAPABILITIES_KICKER),
                    actions = { ZarvisChip(label = tr(UiString.COMMON_PLANS_QUOTAS), onClick = onOpenPlans, icon = ZarvisIcons.Plan) },
                )
            }

            when {
                uiState.isLoading -> item { SkeletonList(loadingLabel = tr(UiString.COMMON_LOADING), rows = 4) }
                uiState.error != null -> item {
                    QueenErrorCard(message = tr(UiString.CAPABILITIES_ERROR), retryLabel = tr(UiString.COMMON_TRY_AGAIN), onRetry = viewModel::refresh)
                }
                else -> {
                    item { SectionKicker(text = tr(UiString.CAPABILITIES_BROWSE_BY_PRODUCT), modifier = Modifier.padding(start = ZarvisSpacing.xs, top = ZarvisSpacing.xs)) }
                    items(FeatureCatalog.pages, key = { it.id }) { page ->
                        ProductCard(page = page, onOpen = { onOpenFeature(page.id) })
                    }
                    item { SectionKicker(text = tr(UiString.CAPABILITIES_SKILLS_NOW), modifier = Modifier.padding(start = ZarvisSpacing.xs, top = ZarvisSpacing.sm)) }
                    uiState.skills.distinctBy { it.id }.groupBy { it.category }.forEach { (category, skills) ->
                        item(key = "category-$category") {
                            Text(
                                text = StatusLabels.humanize(category),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.ExtraBold,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(start = ZarvisSpacing.xs),
                            )
                        }
                        items(skills, key = { "skill-${it.id}" }) { skill ->
                            SkillShowcaseCard(skill = skill, onRun = { onRunSkill("Use ${skill.name}") })
                        }
                    }
                }
            }
            item { Spacer(modifier = Modifier.size(ZarvisSpacing.xxl)) }
        }
    }
}

/** A product page: its jewel, what kind of thing it is, its name and summary, how far it works today, and Open. */
@Composable
private fun ProductCard(page: FeaturePage, onOpen: () -> Unit) {
    val (icon, jewel) = lookForPage(page.id)
    GlassSurface(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp), contentPadding = 16.dp) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            JewelIcon(icon, jewel, size = 48.dp)
            Column(modifier = Modifier.weight(1f)) {
                Text(page.category, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Text(page.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
            }
        }
        Text(
            page.summary,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 10.dp),
        )
        Text(page.availability, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 6.dp))
        ZarvisSecondaryButton(text = tr(UiString.COMMON_OPEN), onClick = onOpen, modifier = Modifier.fillMaxWidth().padding(top = 10.dp))
    }
}

@Composable
private fun SkillShowcaseCard(skill: SkillDto, onRun: () -> Unit) {
    val (icon, jewel) = lookForCategory(skill.category)
    GlassSurface(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp), contentPadding = 16.dp) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            JewelIcon(icon, jewel, size = 44.dp)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(text = skill.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                RiskBadgeLevel.fromWire(skill.riskLevel)?.let { RiskBadge(level = it) }
                Text(
                    text = skill.description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        ZarvisPrimaryButton(text = tr(UiString.CAPABILITIES_RUN), onClick = onRun, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
    }
}

/**
 * A category's jewel and glyph — the lightweight, honest stand-in for a per-skill "visual mockup": with dozens of
 * dynamically-added skills, a bespoke illustration per skill would mean fabricating artwork for skills that don't exist yet, so
 * this reuses the same category iconography as the Workspace chips.
 */
private fun lookForCategory(category: String): Pair<ImageVector, Jewel> = when (category.uppercase()) {
    "WEB" -> ZarvisIcons.Globe to Jewel.SAPPHIRE
    "DOCUMENTS", "DOCS" -> ZarvisIcons.File to Jewel.EMERALD
    "DEVELOPER" -> ZarvisIcons.Code to Jewel.AMETHYST
    "BUSINESS" -> ZarvisIcons.Briefcase to Jewel.GOLD
    "CREATIVE" -> ZarvisIcons.Pen to Jewel.ORCHID
    "AUTOMATION" -> ZarvisIcons.Refresh to Jewel.SAPPHIRE
    "RESEARCH" -> ZarvisIcons.Search to Jewel.SAPPHIRE
    "PHONE" -> ZarvisIcons.Phone to Jewel.RUBY
    else -> ZarvisIcons.Bolt to Jewel.GOLD
}

private fun lookForPage(id: String): Pair<ImageVector, Jewel> {
    val key = id.lowercase()
    return when {
        "voice" in key -> ZarvisIcons.Mic to Jewel.AMETHYST
        "phone" in key -> ZarvisIcons.Phone to Jewel.RUBY
        "developer" in key || "code" in key -> ZarvisIcons.Code to Jewel.EMERALD
        "document" in key || "file" in key -> ZarvisIcons.File to Jewel.EMERALD
        "research" in key || "web" in key || "search" in key -> ZarvisIcons.Search to Jewel.SAPPHIRE
        "creative" in key -> ZarvisIcons.Pen to Jewel.ORCHID
        "business" in key -> ZarvisIcons.Briefcase to Jewel.GOLD
        "task" in key || "automation" in key -> ZarvisIcons.Task to Jewel.SAPPHIRE
        "memory" in key -> ZarvisIcons.Memory to Jewel.ORCHID
        else -> ZarvisIcons.Sparkle to Jewel.GOLD
    }
}
