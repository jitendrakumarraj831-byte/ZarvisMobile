package com.zarvismobile.core.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.GlowColors
import com.zarvismobile.core.ui.theme.ZarvisAccentCyan
import com.zarvismobile.core.ui.theme.ZarvisAccentIndigo
import com.zarvismobile.core.ui.theme.ZarvisErrorDark

/**
 * The primary voice-first affordance on the Home/Workspace screen (MASTER_SPEC.md §14). Each
 * [VoiceState] renders a visually distinct animation — including an ambient glow halo behind
 * the core sweep — so the user always knows what the system is doing (§11); this is a
 * state-communication device, not decoration. Every transition is a plain state read, so the
 * orb reacts the instant [state] changes — there is no debounce or animation warm-up, which is
 * what keeps voice/text interactions feeling sub-second (§22).
 */
@Composable
fun AiOrb(
    state: VoiceState,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 120.dp,
) {
    val transition = rememberInfiniteTransition(label = "ai-orb")

    val pulse by transition.animateFloat(
        initialValue = 0.9f,
        targetValue = 1.08f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = pulseDurationMs(state), easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "ai-orb-pulse",
    )

    val glowPulse by transition.animateFloat(
        initialValue = 0.55f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = glowDurationMs(state), easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "ai-orb-glow",
    )

    val rotationDegrees by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = rotationDurationMs(state), easing = LinearEasing),
        ),
        label = "ai-orb-rotation",
    )

    val (colorStart, colorEnd) = orbColors(state)
    val description = contentDescriptionFor(state)
    val interactionSource = remember { MutableInteractionSource() }
    val scale = if (state == VoiceState.LISTENING || state == VoiceState.SPEAKING) pulse else 1f
    val glowStrength = glowIntensity(state) * glowPulse

    Canvas(
        modifier = modifier
            .size(size)
            .semantics { contentDescription = description }
            .clickable(interactionSource = interactionSource, indication = null, onClick = onClick),
    ) {
        val radius = (this.size.minDimension / 2f) * scale
        val center = Offset(this.size.width / 2f, this.size.height / 2f)

        // Ambient glow halo — energetic, brighter for EXECUTING/SUCCESS so a running task
        // reads as unmistakably "alive" at a glance (MASTER_SPEC.md §22 "glowing pulse effects").
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(colorStart.copy(alpha = glowStrength), Color.Transparent),
                center = center,
                radius = radius * 1.9f,
            ),
            radius = radius * 1.9f,
            center = center,
        )

        rotate(degrees = rotationDegrees, pivot = center) {
            drawCircle(
                brush = Brush.sweepGradient(listOf(colorStart, colorEnd, colorStart), center = center),
                radius = radius,
                center = center,
            )
        }
    }
}

private fun orbColors(state: VoiceState): Pair<Color, Color> = when (state) {
    VoiceState.IDLE -> ZarvisAccentCyan to ZarvisAccentIndigo.copy(alpha = 0.6f)
    VoiceState.LISTENING -> GlowColors.active to ZarvisAccentIndigo
    VoiceState.UNDERSTANDING, VoiceState.PLANNING -> ZarvisAccentIndigo to GlowColors.active
    VoiceState.EXECUTING -> GlowColors.active to GlowColors.active.copy(alpha = 0.5f)
    VoiceState.SUCCESS -> GlowColors.success to GlowColors.success.copy(alpha = 0.5f)
    VoiceState.SPEAKING -> ZarvisAccentIndigo to GlowColors.active
    VoiceState.ERROR -> ZarvisErrorDark to ZarvisErrorDark.copy(alpha = 0.6f)
}

private fun glowIntensity(state: VoiceState): Float = when (state) {
    VoiceState.EXECUTING -> 0.55f
    VoiceState.SUCCESS -> 0.6f
    VoiceState.LISTENING -> 0.45f
    VoiceState.ERROR -> 0.4f
    else -> 0.28f
}

private fun pulseDurationMs(state: VoiceState): Int = when (state) {
    VoiceState.LISTENING -> 700
    VoiceState.SPEAKING -> 500
    else -> 1200
}

private fun glowDurationMs(state: VoiceState): Int = when (state) {
    VoiceState.EXECUTING -> 350
    VoiceState.SUCCESS -> 300
    VoiceState.LISTENING -> 500
    else -> 900
}

private fun rotationDurationMs(state: VoiceState): Int = when (state) {
    VoiceState.PLANNING, VoiceState.UNDERSTANDING -> 1500
    VoiceState.EXECUTING -> 900
    VoiceState.SUCCESS -> 2400
    else -> 6000
}

private fun contentDescriptionFor(state: VoiceState): String = when (state) {
    VoiceState.IDLE -> "Tap to speak"
    VoiceState.LISTENING -> "Listening"
    VoiceState.UNDERSTANDING -> "Understanding your request"
    VoiceState.PLANNING -> "Planning"
    VoiceState.EXECUTING -> "Working on it"
    VoiceState.SUCCESS -> "Done"
    VoiceState.SPEAKING -> "Speaking"
    VoiceState.ERROR -> "Something went wrong"
}
