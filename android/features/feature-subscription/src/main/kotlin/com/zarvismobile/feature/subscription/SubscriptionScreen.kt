package com.zarvismobile.feature.subscription

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.ZarvisAccentCyan
import com.zarvismobile.core.ui.theme.ZarvisSpacing

private data class PlanTier(
    val name: String,
    val tagline: String,
    val features: List<String>,
    val highlighted: Boolean,
)

private val FREE_TIER = PlanTier(
    name = "FREE",
    tagline = "Get started with zero commitment.",
    features = listOf(
        "LOW-risk, low-cost skills only",
        "Voice + text, English/Hindi/Hinglish",
        "Standard response speed",
    ),
    highlighted = false,
)

private val PRO_TIER = PlanTier(
    name = "PRO",
    tagline = "Full access across every shipped skill.",
    features = listOf(
        "Every skill ZARVIS ships, at every risk tier",
        "Higher usage/credit ceiling",
        "Priority orchestrator queueing",
    ),
    highlighted = true,
)

/** Plans & Quotas — MASTER_SPEC.md §19-21 (Subscription/Trial/Usage), Free vs Pro comparison. */
@Composable
fun SubscriptionScreen(viewModel: SubscriptionViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    var billedYearly by remember { mutableStateOf(false) }

    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(ZarvisSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            item { Text(text = "Plans & Quotas", style = MaterialTheme.typography.headlineMedium) }

            if (uiState.isLoading) {
                item { CircularProgressIndicator() }
            }
            uiState.error?.let { error ->
                item { Text(text = error, color = MaterialTheme.colorScheme.error) }
            }

            uiState.entitlement?.let { entitlement ->
                item {
                    GlassPanel(modifier = Modifier.fillMaxWidth()) {
                        Text(text = "Current plan: ${entitlement.plan}", style = MaterialTheme.typography.titleMedium)
                        Text(text = "${entitlement.creditBalance} credits remaining")
                        entitlement.trialExpiresAt?.let { Text(text = "Trial ends: $it") }
                    }
                }
            }

            item {
                Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    BillingToggle(yearly = billedYearly, onToggle = { billedYearly = it })
                }
            }

            item {
                PlanComparisonCard(
                    plan = FREE_TIER,
                    isCurrent = uiState.entitlement?.plan == "FREE",
                )
            }

            item {
                PlanComparisonCard(
                    plan = PRO_TIER,
                    isCurrent = uiState.entitlement?.plan == "PRO",
                    billingNote = if (billedYearly) "Billed yearly · pricing coming soon" else "Billed monthly · pricing coming soon",
                )
            }

            item {
                GlassPanel(modifier = Modifier.fillMaxWidth()) {
                    Text(text = "Upgrading", style = MaterialTheme.typography.titleMedium)
                    Text(
                        text = "Live purchases via Google Play Billing are not enabled in this build " +
                            "(no Play Console listing exists for this repository yet — see MASTER_SPEC.md §32). " +
                            "The billing verification endpoint is implemented and ready to wire up.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    ZarvisSecondaryButton(text = "Upgrade (coming soon)", onClick = {}, enabled = false)
                }
            }

            item { Spacer(modifier = Modifier.size(ZarvisSpacing.xxl)) }
        }
    }
}

@Composable
private fun GlassPanel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .background(color = GlassColors.surfaceTint, shape = RoundedCornerShape(24.dp))
            .border(width = 1.dp, color = GlassColors.border, shape = RoundedCornerShape(24.dp))
            .padding(ZarvisSpacing.md),
        verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
        content = content,
    )
}

@Composable
private fun BillingToggle(yearly: Boolean, onToggle: (Boolean) -> Unit) {
    Row(
        modifier = Modifier
            .background(color = GlassColors.surfaceTintElevated, shape = RoundedCornerShape(50))
            .border(width = 1.dp, color = GlassColors.border, shape = RoundedCornerShape(50))
            .padding(4.dp),
    ) {
        BillingToggleOption(label = "Monthly", selected = !yearly, onClick = { onToggle(false) })
        BillingToggleOption(label = "Yearly", selected = yearly, onClick = { onToggle(true) })
    }
}

@Composable
private fun BillingToggleOption(label: String, selected: Boolean, onClick: () -> Unit) {
    val backgroundColor = if (selected) ZarvisAccentCyan.copy(alpha = 0.18f) else Color.Transparent
    val foregroundColor = if (selected) ZarvisAccentCyan else MaterialTheme.colorScheme.onSurfaceVariant
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(backgroundColor)
            .clickable(onClick = onClick)
            .padding(horizontal = ZarvisSpacing.md, vertical = ZarvisSpacing.sm),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = label, style = MaterialTheme.typography.labelLarge, color = foregroundColor)
    }
}

@Composable
private fun PlanComparisonCard(plan: PlanTier, isCurrent: Boolean, billingNote: String? = null) {
    val borderColor = if (plan.highlighted) ZarvisAccentCyan else GlassColors.border
    val borderWidth = if (plan.highlighted) 1.5.dp else 1.dp
    val nameColor = if (plan.highlighted) ZarvisAccentCyan else MaterialTheme.colorScheme.onSurface

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(color = GlassColors.surfaceTint, shape = RoundedCornerShape(24.dp))
            .border(width = borderWidth, color = borderColor, shape = RoundedCornerShape(24.dp))
            .padding(ZarvisSpacing.md),
        verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(text = plan.name, style = MaterialTheme.typography.titleLarge, color = nameColor)
            if (isCurrent) {
                Text(text = "Current plan", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (plan.highlighted) {
                Text(text = "Recommended", style = MaterialTheme.typography.labelMedium, color = ZarvisAccentCyan)
            }
        }
        Text(text = plan.tagline, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        billingNote?.let {
            Text(text = it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        plan.features.forEach { feature ->
            Text(text = "✓  $feature", style = MaterialTheme.typography.bodyMedium)
        }
    }
}
