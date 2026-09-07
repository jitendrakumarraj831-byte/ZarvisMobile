package com.zarvismobile.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.RiskColors

/** LOW/MEDIUM/HIGH risk indicator — shown wherever an action's risk is surfaced (MASTER_SPEC.md §21). */
enum class RiskBadgeLevel { LOW, MEDIUM, HIGH }

@Composable
fun RiskBadge(level: RiskBadgeLevel, modifier: Modifier = Modifier) {
    val color = when (level) {
        RiskBadgeLevel.LOW -> RiskColors.low
        RiskBadgeLevel.MEDIUM -> RiskColors.medium
        RiskBadgeLevel.HIGH -> RiskColors.high
    }
    Text(
        text = level.name,
        style = MaterialTheme.typography.labelMedium,
        color = color,
        modifier = modifier
            .background(color = color.copy(alpha = 0.15f), shape = RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}
