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
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.ZarvisAccentBlue
import com.zarvismobile.core.ui.theme.ZarvisAccentCyan
import com.zarvismobile.core.ui.theme.ZarvisAccentPink
import com.zarvismobile.core.ui.theme.ZarvisAccentViolet

data class ZarvisNavItem(val route: String, val label: String, val icon: ImageVector)

/**
 * The tab bar: a floating glass pill with an aurora edge (cyan → blue → violet → pink, the website's tab-bar hairline). The current
 * tab sits on a tinted pill behind its icon and its label turns bolder, so the state is never carried by colour alone; every tab is
 * one 56dp-tall button that announces itself as a selected or unselected tab.
 *
 * It does not blur what scrolls underneath (a blur costs a low-end phone a re-blur every frame), so its fill is nearly opaque
 * instead: the surface colour at 94%, which keeps text legible in both themes.
 */
@Composable
fun GlassBottomBar(items: List<ZarvisNavItem>, selectedRoute: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    val barShape = RoundedCornerShape(26.dp)
    val barFill = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f)
    val edge = Brush.horizontalGradient(
        listOf(ZarvisAccentCyan, ZarvisAccentBlue, ZarvisAccentViolet, ZarvisAccentPink).map { it.copy(alpha = 0.55f) },
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
                    modifier = Modifier
                        .widthIn(min = 56.dp)
                        .heightIn(min = 56.dp)
                        .clip(RoundedCornerShape(18.dp))
                        .selectable(selected = isSelected, role = Role.Tab, onClick = { onSelect(item.route) })
                        .padding(horizontal = 4.dp, vertical = 4.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(width = 52.dp, height = 28.dp)
                            .background(if (isSelected && item.route == "chat") edge else pill, RoundedCornerShape(14.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = item.icon,
                            contentDescription = null,
                            modifier = Modifier.size(22.dp),
                            tint = if (isSelected && item.route == "chat") MaterialTheme.colorScheme.onPrimary else tint,
                        )
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
