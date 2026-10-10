package com.zarvismobile.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.theme.RiskColors
import com.zarvismobile.domain.presentation.UiString

/** LOW/MEDIUM/HIGH risk indicator — shown wherever an action's risk is surfaced (MASTER_SPEC.md §21). */
enum class RiskBadgeLevel(val label: String, val uiString: UiString) {
    LOW("Low risk", UiString.RISK_LOW),
    MEDIUM("Medium risk", UiString.RISK_MEDIUM),
    HIGH("High risk", UiString.RISK_HIGH),
    VERY_HIGH("Very high risk", UiString.RISK_VERY_HIGH),
    ;

    companion object {
        /**
         * The level for a code the server sent, or `null` for one this app has never seen. `valueOf` used to be called on
         * these codes and would crash the screen on a new one; a caller now shows nothing (or the plain code) instead.
         */
        fun fromWire(code: String?): RiskBadgeLevel? = entries.firstOrNull { it.name.equals(code?.trim(), ignoreCase = true) }
    }
}

@Composable
fun RiskBadge(level: RiskBadgeLevel, modifier: Modifier = Modifier) {
    val color = when (level) {
        RiskBadgeLevel.LOW -> RiskColors.low
        RiskBadgeLevel.MEDIUM -> RiskColors.medium
        RiskBadgeLevel.HIGH, RiskBadgeLevel.VERY_HIGH -> RiskColors.high
    }
    Text(
        text = tr(level.uiString),
        style = MaterialTheme.typography.labelMedium,
        color = color,
        modifier = modifier
            .background(color = color.copy(alpha = 0.15f), shape = RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}
