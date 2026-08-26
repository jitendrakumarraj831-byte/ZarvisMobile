package com.jarvismobile.core.ui.components

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
import com.jarvismobile.core.ui.theme.JarvisAccentCyan
import com.jarvismobile.core.ui.theme.JarvisAccentIndigo
import com.jarvismobile.core.ui.theme.JarvisErrorDark

/**
 * The primary voice-first affordance on the Home screen (MASTER_SPEC.md §14). Each
 * [VoiceState] renders a visually distinct animation so the user always knows what the
 * system is doing (§11) — this is a state-communication device, not decoration.
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

    Canvas(
        modifier = modifier
            .size(size)
            .semantics { contentDescription = description }
            .clickable(interactionSource = interactionSource, indication = null, onClick = onClick),
    ) {
        val radius = (this.size.minDimension / 2f) * scale
        val center = Offset(this.size.width / 2f, this.size.height / 2f)

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
    VoiceState.IDLE -> JarvisAccentIndigo to JarvisAccentIndigo.copy(alpha = 0.6f)
    VoiceState.LISTENING -> JarvisAccentCyan to JarvisAccentIndigo
    VoiceState.UNDERSTANDING, VoiceState.PLANNING -> JarvisAccentIndigo to JarvisAccentCyan
    VoiceState.EXECUTING -> JarvisAccentCyan to JarvisAccentCyan.copy(alpha = 0.5f)
    VoiceState.SPEAKING -> JarvisAccentIndigo to JarvisAccentCyan
    VoiceState.ERROR -> JarvisErrorDark to JarvisErrorDark.copy(alpha = 0.6f)
}

private fun pulseDurationMs(state: VoiceState): Int = when (state) {
    VoiceState.LISTENING -> 700
    VoiceState.SPEAKING -> 500
    else -> 1200
}

private fun rotationDurationMs(state: VoiceState): Int = when (state) {
    VoiceState.PLANNING, VoiceState.UNDERSTANDING -> 1500
    VoiceState.EXECUTING -> 900
    else -> 6000
}

private fun contentDescriptionFor(state: VoiceState): String = when (state) {
    VoiceState.IDLE -> "Tap to speak"
    VoiceState.LISTENING -> "Listening"
    VoiceState.UNDERSTANDING -> "Understanding your request"
    VoiceState.PLANNING -> "Planning"
    VoiceState.EXECUTING -> "Working on it"
    VoiceState.SPEAKING -> "Speaking"
    VoiceState.ERROR -> "Something went wrong"
}
