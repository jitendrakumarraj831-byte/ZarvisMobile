package com.zarvismobile.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.i18n.tr
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

/**
 * Colour is never the only signal (the level is spelled out). A tinted pill like [StatusBadge]: green low, gold medium, rose high.
 * Very high is the one filled pill, in the danger colour with its own ink, so it stands apart from high at a glance.
 */
@Composable
fun RiskBadge(level: RiskBadgeLevel, modifier: Modifier = Modifier) {
    when (level) {
        RiskBadgeLevel.LOW -> JewelPill(label = tr(level.uiString), jewel = Jewel.EMERALD, modifier = modifier)
        RiskBadgeLevel.MEDIUM -> JewelPill(label = tr(level.uiString), jewel = Jewel.GOLD, modifier = modifier)
        RiskBadgeLevel.HIGH -> JewelPill(label = tr(level.uiString), jewel = Jewel.RUBY, modifier = modifier)
        RiskBadgeLevel.VERY_HIGH -> Text(
            text = tr(level.uiString),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onError,
            maxLines = 1,
            modifier = modifier
                .background(MaterialTheme.colorScheme.error, RoundedCornerShape(50))
                .padding(horizontal = 10.dp, vertical = 3.dp),
        )
    }
}
