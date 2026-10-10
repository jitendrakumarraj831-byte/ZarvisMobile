package com.zarvismobile.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.GlowColors
import com.zarvismobile.core.ui.theme.ZarvisAccentIndigoLight
import com.zarvismobile.core.ui.theme.ZarvisErrorLight
import com.zarvismobile.core.ui.theme.ZarvisSuccessLight
import com.zarvismobile.core.ui.theme.ZarvisWarningLight
import com.zarvismobile.domain.presentation.StatusTone

/**
 * A short, readable state ("Running", "Completed") with a colour that says whether it is going well. The words come from
 * `StatusLabels`, never from a raw server code. Colour is never the only signal: the label is always there.
 */
@Composable
fun StatusBadge(label: String, tone: StatusTone, modifier: Modifier = Modifier) {
    // The glow colours are made for the dark theme; on the light theme they would be pale text on a pale chip.
    val light = MaterialTheme.colorScheme.background.luminance() > 0.5f
    val color = when (tone) {
        StatusTone.ACTIVE -> if (light) ZarvisAccentIndigoLight else GlowColors.active
        StatusTone.WAITING -> if (light) ZarvisWarningLight else GlowColors.warning
        StatusTone.SUCCESS -> if (light) ZarvisSuccessLight else GlowColors.success
        StatusTone.PROBLEM -> if (light) ZarvisErrorLight else GlowColors.error
        StatusTone.NEUTRAL -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Text(
        text = label,
        style = MaterialTheme.typography.labelMedium,
        color = color,
        modifier = modifier
            .background(color = color.copy(alpha = 0.15f), shape = RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}
