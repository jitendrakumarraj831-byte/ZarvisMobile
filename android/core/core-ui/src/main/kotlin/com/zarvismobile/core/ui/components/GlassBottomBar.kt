package com.zarvismobile.core.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.ZarvisAmber
import com.zarvismobile.core.ui.theme.ZarvisAmethyst
import com.zarvismobile.core.ui.theme.ZarvisGold
import com.zarvismobile.core.ui.theme.ZarvisGoldPale
import com.zarvismobile.core.ui.theme.ZarvisInkOnGold
import com.zarvismobile.core.ui.theme.ZarvisOrchid

/** One tab. A [prominent] tab (Chat, in the middle) is drawn as the gold orb instead of an icon on a pill. */
data class ZarvisNavItem(val route: String, val label: String, val icon: ImageVector, val prominent: Boolean = false)

/**
 * The tab bar: a floating plum (light: white) pill with a jewel edge (gold → orchid → amethyst → gold). The current tab sits on a
 * gold-tinted pill behind its icon and its label turns bolder, so the state is never carried by colour alone; every tab is one
 * 56dp-tall button that announces itself as a selected or unselected tab. The prominent tab is a gold orb with a soft glow; while
 * it is the current tab it also wears a ring.
 *
 * It does not blur what scrolls underneath (a blur costs a low-end phone a re-blur every frame), so its fill is nearly opaque
 * instead: the surface colour at 94%, which keeps text legible in both themes.
 */
@Composable
fun GlassBottomBar(items: List<ZarvisNavItem>, selectedRoute: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    val barShape = RoundedCornerShape(26.dp)
    val barFill = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f)
    val edge = Brush.horizontalGradient(
        listOf(ZarvisGold, ZarvisOrchid, ZarvisAmethyst, ZarvisGold).map { it.copy(alpha = 0.55f) },
    )
    Box(modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 14.dp, vertical = 8.dp)) {
        Row(
            Modifier.fillMaxWidth()
                .background(barFill, barShape)
                .border(1.dp, edge, barShape)
                .padding(horizontal = 6.dp, vertical = 5.dp)
                .selectableGroup(),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            items.forEach { item ->
                val isSelected = item.route == selectedRoute
                val tint by animateColorAsState(
                    if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    label = "nav-tint",
                )
                val pill by animateColorAsState(
                    if (isSelected) MaterialTheme.colorScheme.primary.copy(alpha = 0.14f) else MaterialTheme.colorScheme.primary.copy(alpha = 0f),
                    label = "nav-pill",
                )
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                    // Every tab gets the same share of the bar, so a long label is shortened instead of pushing the last tab out.
                    modifier = Modifier
                        .weight(1f)
                        .heightIn(min = 56.dp)
                        .clip(RoundedCornerShape(18.dp))
                        .selectable(selected = isSelected, role = Role.Tab, onClick = { onSelect(item.route) })
                        .padding(horizontal = 4.dp, vertical = 4.dp),
                ) {
                    if (item.prominent) {
                        GoldOrb(item.icon, isSelected, ringColor = MaterialTheme.colorScheme.onSurface)
                    } else {
                        Box(
                            modifier = Modifier.size(width = 52.dp, height = 28.dp).background(pill, RoundedCornerShape(14.dp)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(imageVector = item.icon, contentDescription = null, modifier = Modifier.size(22.dp), tint = tint)
                        }
                    }
                    Text(
                        item.label,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
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

/** The middle tab's orb: gold, with a dark plum icon (over 8:1 on every gold stop) and a soft gold glow behind it. */
@Composable
private fun GoldOrb(icon: ImageVector, selected: Boolean, ringColor: Color) {
    val glow = ZarvisGold.copy(alpha = if (selected) 0.55f else 0.35f)
    Box(
        modifier = Modifier
            .size(44.dp)
            .drawBehind {
                // Kept inside the tab's own bounds, which clip its press ripple.
                drawCircle(
                    brush = Brush.radialGradient(listOf(glow, Color.Transparent), center = center, radius = size.minDimension * 0.62f),
                    radius = size.minDimension * 0.62f,
                )
            }
            .background(Brush.linearGradient(listOf(ZarvisGoldPale, ZarvisGold, ZarvisAmber)), CircleShape)
            .then(if (selected) Modifier.border(2.dp, ringColor, CircleShape) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Icon(imageVector = icon, contentDescription = null, modifier = Modifier.size(22.dp), tint = ZarvisInkOnGold)
    }
}
