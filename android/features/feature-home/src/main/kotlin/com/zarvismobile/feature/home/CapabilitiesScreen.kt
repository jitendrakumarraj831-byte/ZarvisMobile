package com.zarvismobile.feature.home

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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = skill.name, style = MaterialTheme.typography.titleMedium)
                Spacer(modifier = Modifier.size(ZarvisSpacing.xs))
                Text(
                    text = skill.description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            RiskBadge(level = RiskBadgeLevel.valueOf(skill.riskLevel))
        }
        Spacer(modifier = Modifier.size(ZarvisSpacing.sm))
        ZarvisPrimaryButton(text = "Run Agent", onClick = onRun, modifier = Modifier.fillMaxWidth())
    }
}
