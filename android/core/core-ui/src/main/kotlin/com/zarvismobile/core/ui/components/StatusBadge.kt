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
import com.zarvismobile.domain.presentation.StatusTone

/**
 * A short, readable state ("Running", "Completed") with a colour that says whether it is going well. The words come from
 * `StatusLabels`, never from a raw server code. Colour is never the only signal: the label is always there.
 *
 * Queen look: a filled jewel pill (sapphire running, gold waiting, emerald done, ruby a problem) with its own dark ink, over 5.5:1
 * on every jewel, so it reads the same on the dark and the light page. A neutral state stays a quiet tint in the theme's own text colour.
 */
@Composable
fun StatusBadge(label: String, tone: StatusTone, modifier: Modifier = Modifier) {
    when (tone) {
        StatusTone.ACTIVE -> JewelPill(label, Jewel.SAPPHIRE, modifier)
        StatusTone.WAITING -> JewelPill(label, Jewel.GOLD, modifier)
        StatusTone.SUCCESS -> JewelPill(label, Jewel.EMERALD, modifier)
        StatusTone.PROBLEM -> JewelPill(label, Jewel.RUBY, modifier)
        StatusTone.NEUTRAL -> {
            val color = MaterialTheme.colorScheme.onSurfaceVariant
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
                color = color,
                modifier = modifier
                    .background(color = color.copy(alpha = 0.15f), shape = RoundedCornerShape(50))
                    .padding(horizontal = 10.dp, vertical = 3.dp),
            )
        }
    }
}

/** A filled pill in a jewel's own colour with its dark ink: the shape every status and risk badge shares. */
@Composable
internal fun JewelPill(label: String, jewel: Jewel, modifier: Modifier = Modifier) {
    Text(
        text = label,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.ExtraBold,
        color = jewel.ink,
        modifier = modifier
            .background(color = jewel.bottom, shape = RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 3.dp),
    )
}
