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
import androidx.compose.runtime.State
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.theme.GlowColors
import com.zarvismobile.core.ui.theme.ZarvisAccentCyan
import com.zarvismobile.core.ui.theme.ZarvisAccentIndigo
import com.zarvismobile.core.ui.theme.ZarvisErrorDark
import com.zarvismobile.core.ui.theme.zarvisReduceMotion
import com.zarvismobile.domain.presentation.UiString

/**
 * The primary voice-first affordance on the Home/Workspace screen (MASTER_SPEC.md §14). Each
 * [VoiceState] renders a visually distinct animation — including an ambient glow halo behind
 * the core sweep — so the user always knows what the system is doing (§11); this is a
 * state-communication device, not decoration. Every transition is a plain state read, so the
 * orb reacts the instant [state] changes — there is no debounce or animation warm-up, which is
 * what keeps voice/text interactions feeling sub-second (§22).
 *
 * Motion costs battery, so it is spent only where it says something: the orb holds still while IDLE and whenever Android's
 * animations are off ("Remove animations"), and only moves for listening, working and speaking. The animated values are read
 * while drawing, not while composing, so a running orb redraws itself without recomposing the screen around it 60 times a second.
 */
@Composable
fun AiOrb(
    state: VoiceState,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 120.dp,
) {
    val reduceMotion = zarvisReduceMotion()
    val moving = !reduceMotion && state != VoiceState.IDLE
    val motion: OrbMotion = if (moving) {
        val transition = rememberInfiniteTransition(label = "ai-orb")
        OrbMotion(
            pulse = transition.animateFloat(
                initialValue = 0.9f,
                targetValue = 1.08f,
                animationSpec = infiniteRepeatable(tween(durationMillis = pulseDurationMs(state), easing = LinearEasing), RepeatMode.Reverse),
                label = "ai-orb-pulse",
            ),
            glow = transition.animateFloat(
                initialValue = 0.55f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(tween(durationMillis = glowDurationMs(state), easing = LinearEasing), RepeatMode.Reverse),
                label = "ai-orb-glow",
            ),
            rotation = transition.animateFloat(
                initialValue = 0f,
                targetValue = 360f,
                animationSpec = infiniteRepeatable(tween(durationMillis = rotationDurationMs(state), easing = LinearEasing)),
                label = "ai-orb-rotation",
            ),
        )
    } else {
        OrbMotion.Still
    }

    val (colorStart, colorEnd) = orbColors(state)
    val description = contentDescriptionFor(state)
    val interactionSource = remember { MutableInteractionSource() }

    Canvas(
        modifier = modifier
            .size(size)
            .semantics { contentDescription = description }
            .clickable(interactionSource = interactionSource, indication = null, role = Role.Button, onClick = onClick),
    ) {
        val scale = if (state == VoiceState.LISTENING || state == VoiceState.SPEAKING) motion.pulse?.value ?: 1f else 1f
        val glowStrength = glowIntensity(state) * (motion.glow?.value ?: 1f)
        val rotation = motion.rotation?.value ?: 0f
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

        rotate(degrees = rotation, pivot = center) {
            drawCircle(
                brush = Brush.sweepGradient(listOf(colorStart, colorEnd, colorStart), center = center),
                radius = radius,
                center = center,
            )
        }
    }
}

/** The three running values of an animated orb, or none at all while it holds still. */
private class OrbMotion(val pulse: State<Float>?, val glow: State<Float>?, val rotation: State<Float>?) {
    companion object {
        val Still = OrbMotion(null, null, null)
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

@Composable
private fun contentDescriptionFor(state: VoiceState): String = tr(
    when (state) {
        VoiceState.IDLE -> UiString.A11Y_ORB_IDLE
        VoiceState.LISTENING -> UiString.A11Y_ORB_LISTENING
        VoiceState.UNDERSTANDING -> UiString.A11Y_ORB_UNDERSTANDING
        VoiceState.PLANNING -> UiString.A11Y_ORB_PLANNING
        VoiceState.EXECUTING -> UiString.A11Y_ORB_WORKING
        VoiceState.SUCCESS -> UiString.A11Y_ORB_DONE
        VoiceState.SPEAKING -> UiString.A11Y_ORB_SPEAKING
        VoiceState.ERROR -> UiString.A11Y_ORB_ERROR
    },
)
