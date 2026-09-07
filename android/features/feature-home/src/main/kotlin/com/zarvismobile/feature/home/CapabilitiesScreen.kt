package com.zarvismobile.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.Brush
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Work
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.components.RiskBadge
import com.zarvismobile.core.ui.components.RiskBadgeLevel
import com.zarvismobile.core.ui.components.ZarvisBackground
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
    viewModel: CapabilitiesViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize().statusBarsPadding()) {
            Column(modifier = Modifier.fillMaxWidth().padding(ZarvisSpacing.lg)) {
                Text(text = "Capabilities", style = MaterialTheme.typography.headlineMedium)
                Text(
                    text = "Everything ZARVIS can do right now, grouped by category.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            when {
                uiState.isLoading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                uiState.error != null -> Box(modifier = Modifier.fillMaxSize().padding(ZarvisSpacing.lg), contentAlignment = Alignment.Center) {
                    Text(text = uiState.error ?: "", color = MaterialTheme.colorScheme.error)
                }
                else -> {
                    val grouped = uiState.skills.groupBy { it.category }
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().weight(1f),
                        contentPadding = PaddingValues(horizontal = ZarvisSpacing.lg, vertical = ZarvisSpacing.md),
                        verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
                    ) {
                        grouped.forEach { (category, skills) ->
                            item {
                                Text(
                                    text = category,
                                    style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                            items(skills) { skill ->
                                SkillShowcaseCard(skill = skill, onRun = { onRunSkill("Use ${skill.name}") })
                            }
                        }
                        item { Spacer(modifier = Modifier.size(ZarvisSpacing.xxl)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun SkillShowcaseCard(skill: SkillDto, onRun: () -> Unit) {
    GlassSurface(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
            CategoryIconAvatar(category = skill.category)
            Column(modifier = Modifier.weight(1f)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(text = skill.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    RiskBadge(level = RiskBadgeLevel.valueOf(skill.riskLevel))
                }
                Spacer(modifier = Modifier.size(ZarvisSpacing.xs))
                Text(
                    text = skill.description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(modifier = Modifier.size(ZarvisSpacing.sm))
        ZarvisPrimaryButton(text = "Run Agent", onClick = onRun, modifier = Modifier.fillMaxWidth())
    }
}

/**
 * A category glyph in a tinted circular chip — the lightweight, honest stand-in for a
 * per-skill "visual mockup": with dozens of dynamically-added skills, a bespoke illustration
 * per skill would mean fabricating artwork for skills that don't exist yet, so this reuses
 * the same recognizable category iconography as the Workspace chip rail instead.
 */
@Composable
private fun CategoryIconAvatar(category: String) {
    Box(
        modifier = Modifier
            .size(40.dp)
            .background(color = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f), shape = CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = iconForCategory(category),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(20.dp),
        )
    }
}

private fun iconForCategory(category: String): ImageVector = when (category.uppercase()) {
    "WEB" -> Icons.Filled.Public
    "DOCUMENTS", "DOCS" -> Icons.Filled.Description
    "DEVELOPER" -> Icons.Filled.Code
    "BUSINESS" -> Icons.Filled.Work
    "CREATIVE" -> Icons.Filled.Brush
    "AUTOMATION" -> Icons.Filled.Autorenew
    "RESEARCH" -> Icons.Filled.Search
    "PHONE" -> Icons.Filled.Phone
    else -> Icons.Filled.FlashOn
}
