package com.zarvismobile.core.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberInfiniteTransition
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.ZarvisSpacing

/**
 * The optimistic-UI "Executing…" (and Listening/Speaking) feedback pill — appears the instant
 * a voice/text turn is submitted, before any network round-trip completes, so the system
 * always feels like it reacted in well under a second (MASTER_SPEC.md §11/§22 sub-second
 * feedback rule). The dot's pulse is a plain alpha tween — no bitmap work, safe at 60fps on
 * low-end Android WebViews/devices.
 */
@Composable
fun StatusPulseBadge(
    label: String,
    glowColor: Color,
    modifier: Modifier = Modifier,
) {
    val transition = rememberInfiniteTransition(label = "status-pulse")
    val alpha by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 600, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "status-pulse-alpha",
    )

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .background(color = glowColor.copy(alpha = 0.12f), shape = RoundedCornerShape(50))
            .border(width = 1.dp, color = glowColor.copy(alpha = 0.5f), shape = RoundedCornerShape(50))
            .padding(horizontal = ZarvisSpacing.sm, vertical = 6.dp),
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .background(color = glowColor.copy(alpha = alpha), shape = CircleShape),
        )
        Spacer(modifier = Modifier.size(ZarvisSpacing.xs))
        Text(text = label, style = MaterialTheme.typography.labelMedium, color = glowColor)
    }
}
