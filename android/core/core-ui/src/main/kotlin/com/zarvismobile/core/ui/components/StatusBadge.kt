package com.zarvismobile.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.domain.presentation.StatusTone

/**
 * A short, readable state ("Running", "Completed") with a colour that says whether it is going well. The words come from
 * `StatusLabels`, never from a raw server code. Colour is never the only signal: the label is always there. The colours are the
 * theme's text-safe ones (see [ZarvisAccents]), so the label reads on a pale chip in light and on a dark one in dark.
 */
@Composable
fun StatusBadge(label: String, tone: StatusTone, modifier: Modifier = Modifier) {
    val color = when (tone) {
        StatusTone.ACTIVE -> MaterialTheme.colorScheme.primary
        StatusTone.WAITING -> ZarvisAccents.warning
        StatusTone.SUCCESS -> ZarvisAccents.success
        StatusTone.PROBLEM -> ZarvisAccents.danger
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
