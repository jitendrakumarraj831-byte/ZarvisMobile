package com.zarvismobile.core.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
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
import androidx.compose.runtime.State
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.core.ui.theme.zarvisReduceMotion

/**
 * The optimistic-UI "Executing…" (and Listening/Speaking) feedback pill — appears the instant
 * a voice/text turn is submitted, before any network round-trip completes, so the system
 * always feels like it reacted in well under a second (MASTER_SPEC.md §11/§22 sub-second
 * feedback rule). The dot's pulse is a plain alpha tween applied in the draw layer (no recomposition per
 * frame, no bitmap work), and it holds still when Android's animations are off.
 */
@Composable
fun StatusPulseBadge(
    label: String,
    glowColor: Color,
    modifier: Modifier = Modifier,
) {
    val pulse: State<Float>? = if (zarvisReduceMotion()) {
        null
    } else {
        rememberInfiniteTransition(label = "status-pulse").animateFloat(
            initialValue = 0.35f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 600, easing = LinearEasing),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "status-pulse-alpha",
        )
    }

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
                .graphicsLayer { alpha = pulse?.value ?: 1f }
                .background(color = glowColor, shape = CircleShape),
        )
        Spacer(modifier = Modifier.size(ZarvisSpacing.xs))
        // The glow colour is for the dot and the edge; the words use the theme's text colour (cyan or green text is 1.7:1 on the light page).
        Text(text = label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface)
    }
}
