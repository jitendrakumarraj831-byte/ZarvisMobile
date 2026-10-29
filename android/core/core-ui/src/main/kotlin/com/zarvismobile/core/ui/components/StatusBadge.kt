package com.zarvismobile.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.domain.presentation.StatusTone

/**
 * A short, readable state ("Running", "Completed") with a colour that says whether it is going well. The words come from
 * `StatusLabels`, never from a raw server code. Colour is never the only signal: the label is always there.
 *
 * Queen Pro look: a pill tinted with its own colour, with a dot and the words in that colour (cyan running, gold waiting, green done,
 * rose a problem). The colours are the theme's text-safe accents, so the chip reads on the dark page and on the light one
 * (PaletteContrastTest checks each on its own tint).
 */
@Composable
fun StatusBadge(label: String, tone: StatusTone, modifier: Modifier = Modifier) {
    TintPill(label = label, color = toneColor(tone), modifier = modifier, dot = true)
}

/** The text colour for a status [tone] in the current theme. */
@Composable
@ReadOnlyComposable
fun toneColor(tone: StatusTone): Color = when (tone) {
    StatusTone.ACTIVE -> ZarvisAccents.cyan
    StatusTone.WAITING -> ZarvisAccents.warning
    StatusTone.SUCCESS -> ZarvisAccents.success
    StatusTone.PROBLEM -> ZarvisAccents.danger
    StatusTone.NEUTRAL -> MaterialTheme.colorScheme.onSurfaceVariant
}

/**
 * The pill every status and risk chip shares: [color] for the words, the same colour at 14% behind them, and (with [dot]) a small dot
 * of it before the words. The dot is decoration: the words say the state.
 */
@Composable
fun TintPill(label: String, color: Color, modifier: Modifier = Modifier, dot: Boolean = false) {
    Row(
        modifier = modifier
            .background(color = color.copy(alpha = 0.14f), shape = RoundedCornerShape(50))
            .padding(start = if (dot) 8.dp else 10.dp, end = 10.dp, top = 3.dp, bottom = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (dot) Box(Modifier.size(6.dp).background(color, CircleShape))
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            color = color,
            maxLines = 1,
        )
    }
}

/** A chip in a jewel's colour family (the risk badge's look), mapped to the theme's text-safe accent of that jewel. */
@Composable
internal fun JewelPill(label: String, jewel: Jewel, modifier: Modifier = Modifier) {
    val color = when (jewel) {
        Jewel.EMERALD -> ZarvisAccents.success
        Jewel.GOLD -> ZarvisAccents.warning
        Jewel.RUBY -> ZarvisAccents.danger
        Jewel.SAPPHIRE -> ZarvisAccents.cyan
        Jewel.AMETHYST -> ZarvisAccents.violet
        Jewel.ORCHID -> ZarvisAccents.pink
    }
    TintPill(label = label, color = color, modifier = modifier)
}
