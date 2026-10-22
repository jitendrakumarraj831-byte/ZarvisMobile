package com.zarvismobile.core.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
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

/** Colour is never the only signal (the level is spelled out). A jewel pill with its own dark ink (see [StatusBadge]), so it reads on both pages. */
@Composable
fun RiskBadge(level: RiskBadgeLevel, modifier: Modifier = Modifier) {
    val jewel = when (level) {
        RiskBadgeLevel.LOW -> Jewel.EMERALD
        RiskBadgeLevel.MEDIUM -> Jewel.GOLD
        RiskBadgeLevel.HIGH, RiskBadgeLevel.VERY_HIGH -> Jewel.RUBY
    }
    JewelPill(label = tr(level.uiString), jewel = jewel, modifier = modifier)
}
