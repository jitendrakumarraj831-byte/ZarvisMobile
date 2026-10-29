package com.zarvismobile.core.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.LocalZarvisExtras
import com.zarvismobile.core.ui.theme.ZarvisAccentBlue
import com.zarvismobile.core.ui.theme.ZarvisAccentViolet
import com.zarvismobile.core.ui.theme.zarvisReduceMotion

/** One tab. */
data class ZarvisNavItem(val route: String, val label: String, val icon: ImageVector)

/**
 * The tab bar (Queen Pro): a flat bar across the bottom with five equal tabs and a hairline on top that glows violet and blue in its
 * middle. The current tab's icon sits on a violet → blue pill and its label turns the theme's primary and bolder, so the state is
 * never carried by colour alone; the others use the secondary text colour (4.5:1 or more). Every tab is one 56dp-tall button that
 * announces itself as a selected or unselected tab. The bar's background runs under the gesture bar (edge to edge); its tabs sit
 * above it. With animations off the selection changes at once instead of fading.
 */
@Composable
fun GlassBottomBar(items: List<ZarvisNavItem>, selectedRoute: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    val hairline = GlassColors.border
    val dark = LocalZarvisExtras.current.isDark
    val edgeGlow = Brush.horizontalGradient(
        listOf(Color.Transparent, ZarvisAccentViolet.copy(alpha = if (dark) 0.7f else 0.45f), ZarvisAccentBlue.copy(alpha = if (dark) 0.7f else 0.45f), Color.Transparent),
    )
    val pillBrush = Brush.horizontalGradient(
        listOf(ZarvisAccentViolet.copy(alpha = if (dark) 0.34f else 0.20f), ZarvisAccentBlue.copy(alpha = if (dark) 0.30f else 0.18f)),
    )
    val still = zarvisReduceMotion()
    Box(
        modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .drawBehind {
                val line = size.copy(height = 1.dp.toPx())
                drawRect(hairline, size = line)
                drawRect(edgeGlow, size = line)
            }
            .navigationBarsPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp).selectableGroup(),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            items.forEach { item ->
                val isSelected = item.route == selectedRoute
                val tint by animateColorAsState(
                    if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    animationSpec = if (still) snap() else spring(),
                    label = "nav-tint",
                )
                val pill by animateFloatAsState(if (isSelected) 1f else 0f, animationSpec = if (still) snap() else spring(), label = "nav-pill")
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    // Every tab gets the same share of the bar, so a long label is shortened instead of pushing the last tab out.
                    modifier = Modifier
                        .weight(1f)
                        .heightIn(min = 56.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .selectable(selected = isSelected, role = Role.Tab, onClick = { onSelect(item.route) })
                        .padding(horizontal = 2.dp, vertical = 4.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(width = 56.dp, height = 30.dp)
                            .drawBehind {
                                if (pill > 0f) drawRoundRect(pillBrush, cornerRadius = CornerRadius(size.height / 2f), alpha = pill)
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(imageVector = item.icon, contentDescription = null, modifier = Modifier.size(22.dp), tint = tint)
                    }
                    Text(
                        item.label,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                        color = tint,
                        maxLines = 1,
                        softWrap = false,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}
