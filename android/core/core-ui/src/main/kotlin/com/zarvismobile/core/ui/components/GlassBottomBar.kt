package com.zarvismobile.core.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.ZarvisSpacing

data class ZarvisNavItem(val route: String, val label: String, val icon: ImageVector)

@Composable
fun GlassBottomBar(items: List<ZarvisNavItem>, selectedRoute: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 14.dp, vertical = 8.dp)) {
        Row(
            Modifier.fillMaxWidth()
                .background(GlassColors.surfaceTintElevated, RoundedCornerShape(24.dp))
                .border(1.dp, GlassColors.borderStrong, RoundedCornerShape(24.dp))
                .padding(horizontal = 6.dp, vertical = 5.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            items.forEach { item ->
                val isSelected = item.route == selectedRoute
                val tint by animateColorAsState(if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant, label = "nav")
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(1.dp),
                    modifier = Modifier
                        .defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)
                        .semantics { role = Role.Tab; selected = isSelected }
                        .clickable { onSelect(item.route) }
                        .padding(horizontal = 2.dp, vertical = 6.dp),
                ) {
                    Icon(imageVector = item.icon, contentDescription = null, modifier = Modifier.size(20.dp), tint = tint)
                    Text(item.label, style = MaterialTheme.typography.labelMedium, color = tint)
                }
            }
        }
    }
}
