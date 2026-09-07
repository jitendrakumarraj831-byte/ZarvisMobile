package com.zarvismobile.core.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.ZarvisSpacing

/** One destination in the floating glass bottom nav — see [GlassBottomBar]. */
data class ZarvisNavItem(
    val route: String,
    val label: String,
    val icon: ImageVector,
)

/**
 * The floating "glass" top-level nav bar (MASTER_SPEC.md §22/§23): Workspace / Capabilities /
 * Plans & Quotas / System Metrics. Sits above the Android gesture/nav bar via
 * [Modifier.navigationBarsPadding] so it never collides with edge-to-edge system chrome.
 */
@Composable
fun GlassBottomBar(
    items: List<ZarvisNavItem>,
    selectedRoute: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = ZarvisSpacing.md, vertical = ZarvisSpacing.sm),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(color = GlassColors.surfaceTintElevated, shape = RoundedCornerShape(28.dp))
                .border(width = 1.dp, color = GlassColors.border, shape = RoundedCornerShape(28.dp))
                .padding(vertical = ZarvisSpacing.xs),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            items.forEach { item ->
                val selected = item.route == selectedRoute
                val tint by animateColorAsState(
                    targetValue = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    label = "nav-item-tint",
                )
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                    modifier = Modifier
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) { onSelect(item.route) }
                        .padding(horizontal = ZarvisSpacing.sm, vertical = ZarvisSpacing.xs),
                ) {
                    Icon(
                        imageVector = item.icon,
                        contentDescription = item.label,
                        tint = tint,
                        modifier = Modifier.size(22.dp),
                    )
                    Text(text = item.label, style = MaterialTheme.typography.labelSmall, color = tint)
                }
            }
        }
    }
}
