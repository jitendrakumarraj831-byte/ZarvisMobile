package com.zarvismobile.core.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.theme.LocalZarvisExtras
import com.zarvismobile.core.ui.theme.ZarvisAccentBlue
import com.zarvismobile.core.ui.theme.ZarvisAccentCyan
import com.zarvismobile.core.ui.theme.ZarvisAccentViolet
import com.zarvismobile.core.ui.theme.ZarvisErrorDark
import com.zarvismobile.core.ui.theme.ZarvisNightIce
import com.zarvismobile.core.ui.theme.ZarvisNightIndigo
import com.zarvismobile.core.ui.theme.ZarvisNightLavender
import com.zarvismobile.core.ui.theme.ZarvisNightSky
import com.zarvismobile.core.ui.theme.ZarvisRose
import com.zarvismobile.core.ui.theme.ZarvisSuccessDark
import com.zarvismobile.core.ui.theme.zarvisReduceMotion
import com.zarvismobile.domain.presentation.UiString
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * The primary voice-first affordance on the Home/Workspace screen (MASTER_SPEC.md §14). Each
 * [VoiceState] renders a visually distinct animation — including an ambient glow halo behind
 * the core sweep — so the user always knows what the system is doing (§11); this is a
 * state-communication device, not decoration. Every transition is a plain state read, so the
 * orb reacts the instant [state] changes — there is no debounce or animation warm-up, which is
 * what keeps voice/text interactions feeling sub-second (§22).
 *
 * In Queen Night it is a lit glass sphere: a soft halo in the state's colour, a sphere lit from the top left, a luminous arc of
 * energy turning inside it, a white-hot core, a fine HUD ring of ticks turning the other way, and an orbit with one bright
 * satellite. Each state has its own colours and its own motion: listening sends out ripples and breathes quickly, working turns
 * fast, speaking pulses, done is green and an error is rose.
 *
 * Motion costs battery, so it is spent only where it says something: the orb holds still while IDLE (unless [idleMotion] asks for
 * a slow breath, which Home does for its hero) and whenever Android's animations are off ("Remove animations") or Lightweight
 * mode is on. The animated values are read while drawing, not while composing, so a running orb redraws itself without
 * recomposing the screen around it 60 times a second.
 *
 * With [onClick] the orb is one button that TalkBack reads by its state ("Tap to speak", "Listening"…); without it, it is
 * decoration and says nothing (an empty chat's emblem, the welcome pages).
 */
@Composable
fun AiOrb(
    state: VoiceState,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    size: Dp = 120.dp,
    idleMotion: Boolean = false,
) {
    val reduceMotion = zarvisReduceMotion()
    val moving = !reduceMotion && (state != VoiceState.IDLE || idleMotion)
    val motion: OrbMotion = if (moving) {
        val transition = rememberInfiniteTransition(label = "ai-orb")
        OrbMotion(
            pulse = transition.animateFloat(
                initialValue = 0.94f,
                targetValue = 1.05f,
                animationSpec = infiniteRepeatable(tween(durationMillis = pulseDurationMs(state), easing = LinearEasing), RepeatMode.Reverse),
                label = "ai-orb-pulse",
            ),
            glow = transition.animateFloat(
                initialValue = if (state == VoiceState.IDLE) 0.7f else 0.55f,
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
            wave = transition.animateFloat(
                initialValue = 0f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(tween(durationMillis = 1_600, easing = LinearEasing)),
                label = "ai-orb-wave",
            ),
        )
    } else {
        OrbMotion.Still
    }

    val colors = orbColors(state)
    // The HUD ring and the orbit: lavender on the night page, violet on the lavender day page (where lavender would vanish).
    val ring = if (LocalZarvisExtras.current.isDark) ZarvisNightLavender else ZarvisAccentViolet
    val interactionSource = remember { MutableInteractionSource() }
    // A short squeeze while pressed (layer scale only): the tap is felt at once, before the screen it opens appears.
    val pressed by interactionSource.collectIsPressedAsState()
    val pressScale by animateFloatAsState(targetValue = if (pressed) 0.94f else 1f, label = "ai-orb-press")
    val tap = if (onClick != null) {
        val description = contentDescriptionFor(state)
        Modifier
            .semantics { contentDescription = description }
            .clickable(interactionSource = interactionSource, indication = null, role = Role.Button, onClick = onClick)
    } else {
        Modifier
    }
    val pulses = state == VoiceState.LISTENING || state == VoiceState.SPEAKING
    val ripples = state == VoiceState.LISTENING

    Canvas(
        modifier = modifier
            .size(size)
            .graphicsLayer {
                scaleX = pressScale
                scaleY = pressScale
            }
            .then(tap),
    ) {
        val scale = if (pulses) motion.pulse?.value ?: 1f else 1f
        val glowStrength = glowIntensity(state) * (motion.glow?.value ?: 1f)
        val rotation = motion.rotation?.value ?: STILL_ROTATION
        // The sphere leaves room inside the canvas for its HUD ring and orbit; the halo spills past the edge on purpose.
        val radius = (this.size.minDimension / 2f) * 0.8f * scale
        val center = Offset(this.size.width / 2f, this.size.height / 2f)

        // The halo: the state's colour bleeding into the page around the sphere.
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(colors.core.copy(alpha = glowStrength), colors.edge.copy(alpha = glowStrength * 0.35f), Color.Transparent),
                center = center,
                radius = radius * 2.1f,
            ),
            radius = radius * 2.1f,
            center = center,
        )

        // Listening: two ripples leave the sphere and fade, like sound arriving.
        if (ripples) {
            val wave = motion.wave?.value ?: 0f
            for (i in 0 until 2) {
                val t = (wave + i * 0.5f) % 1f
                drawCircle(
                    color = colors.core.copy(alpha = 0.45f * (1f - t)),
                    radius = radius * (1.05f + 0.6f * t),
                    center = center,
                    style = Stroke(width = radius * 0.025f),
                )
            }
        }

        // The orbit and its satellite.
        val orbit = radius * 1.22f
        drawCircle(color = ring.copy(alpha = 0.2f), radius = orbit, center = center, style = Stroke(width = radius * 0.012f))
        val a = (rotation * 0.75f - 50f) * PI.toFloat() / 180f
        val satellite = Offset(center.x + orbit * cos(a), center.y + orbit * sin(a))
        drawCircle(
            brush = Brush.radialGradient(listOf(colors.highlight, colors.core.copy(alpha = 0f)), center = satellite, radius = radius * 0.12f),
            radius = radius * 0.12f,
            center = satellite,
        )
        drawCircle(color = colors.highlight, radius = radius * 0.035f, center = satellite)

        // The HUD ring of ticks, turning against the arc inside.
        rotate(degrees = -rotation / 2f, pivot = center) {
            for (i in 0 until ORB_TICKS) {
                val angle = i * 2.0 * PI / ORB_TICKS
                val major = i % 4 == 0
                val inner = radius * (if (major) 1.04f else 1.06f)
                val outer = radius * 1.1f
                drawLine(
                    color = ring.copy(alpha = if (major) 0.55f else 0.22f),
                    start = Offset(center.x + inner * cos(angle).toFloat(), center.y + inner * sin(angle).toFloat()),
                    end = Offset(center.x + outer * cos(angle).toFloat(), center.y + outer * sin(angle).toFloat()),
                    strokeWidth = radius * 0.02f,
                )
            }
        }

        // The sphere, lit from the top left: ice white into the state's colours, into deep navy at the far edge.
        drawCircle(
            brush = Brush.radialGradient(
                0f to colors.highlight,
                0.28f to colors.core,
                0.72f to colors.edge,
                1f to OrbShadow,
                center = Offset(center.x - radius * 0.32f, center.y - radius * 0.38f),
                radius = radius * 1.55f,
            ),
            radius = radius,
            center = center,
        )

        // The arc of energy turning inside the sphere.
        rotate(degrees = rotation, pivot = center) {
            val arcRadius = radius * 0.7f
            drawArc(
                brush = Brush.sweepGradient(
                    0f to Color.Transparent,
                    0.45f to colors.highlight.copy(alpha = 0.0f),
                    0.85f to colors.highlight.copy(alpha = 0.85f),
                    1f to Color.Transparent,
                    center = center,
                ),
                startAngle = 0f,
                sweepAngle = 300f,
                useCenter = false,
                topLeft = Offset(center.x - arcRadius, center.y - arcRadius),
                size = Size(arcRadius * 2f, arcRadius * 2f),
                style = Stroke(width = radius * 0.07f, cap = StrokeCap.Round),
            )
        }

        // The white-hot core.
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(Color.White.copy(alpha = 0.8f), colors.core.copy(alpha = 0.35f), Color.Transparent),
                center = center,
                radius = radius * 0.5f,
            ),
            radius = radius * 0.5f,
            center = center,
        )

        // The glass rim, brighter where the light falls, and the specular glint.
        drawCircle(
            brush = Brush.linearGradient(
                listOf(colors.highlight.copy(alpha = 0.85f), colors.edge.copy(alpha = 0.15f)),
                start = Offset(center.x - radius, center.y - radius),
                end = Offset(center.x + radius, center.y + radius),
            ),
            radius = radius * 0.985f,
            center = center,
            style = Stroke(width = radius * 0.03f),
        )
        val glint = Offset(center.x - radius * 0.38f, center.y - radius * 0.46f)
        drawCircle(
            brush = Brush.radialGradient(listOf(Color.White.copy(alpha = 0.55f), Color.Transparent), center = glint, radius = radius * 0.24f),
            radius = radius * 0.24f,
            center = glint,
        )
    }
}

private const val ORB_TICKS = 48

/** Where the arc and the satellite sit when the orb holds still: turned a little, so even a still orb has its light at the top left. */
private const val STILL_ROTATION = 300f

/** The deep navy at the sphere's far edge. */
private val OrbShadow = Color(0xFF0B1030)

/** The running values of an animated orb, or none at all while it holds still. */
private class OrbMotion(val pulse: State<Float>?, val glow: State<Float>?, val rotation: State<Float>?, val wave: State<Float>?) {
    companion object {
        val Still = OrbMotion(null, null, null, null)
    }
}

/** A state's colours: the bright [highlight] where the light falls, the [core] colour and the [edge] it turns into. */
private class OrbColors(val highlight: Color, val core: Color, val edge: Color)

private fun orbColors(state: VoiceState): OrbColors = when (state) {
    VoiceState.IDLE -> OrbColors(ZarvisNightIce, ZarvisAccentViolet, ZarvisAccentBlue)
    VoiceState.LISTENING -> OrbColors(Color.White, ZarvisAccentCyan, ZarvisAccentBlue)
    VoiceState.UNDERSTANDING, VoiceState.PLANNING -> OrbColors(ZarvisNightLavender, ZarvisAccentViolet, ZarvisNightIndigo)
    VoiceState.EXECUTING -> OrbColors(ZarvisNightIce, ZarvisNightSky, ZarvisNightIndigo)
    VoiceState.SUCCESS -> OrbColors(Color(0xFFDCFCE7), ZarvisSuccessDark, Color(0xFF059669))
    VoiceState.SPEAKING -> OrbColors(ZarvisNightIce, ZarvisNightLavender, ZarvisAccentViolet)
    VoiceState.ERROR -> OrbColors(Color(0xFFFFE4E6), ZarvisErrorDark, ZarvisRose)
}

private fun glowIntensity(state: VoiceState): Float = when (state) {
    VoiceState.EXECUTING -> 0.55f
    VoiceState.SUCCESS -> 0.6f
    VoiceState.LISTENING -> 0.6f
    VoiceState.ERROR -> 0.45f
    VoiceState.SPEAKING -> 0.5f
    else -> 0.42f
}

private fun pulseDurationMs(state: VoiceState): Int = when (state) {
    VoiceState.LISTENING -> 700
    VoiceState.SPEAKING -> 500
    else -> 1200
}

private fun glowDurationMs(state: VoiceState): Int = when (state) {
    VoiceState.IDLE -> 3_200 // the slow breath of Home's hero orb
    VoiceState.EXECUTING -> 350
    VoiceState.SUCCESS -> 300
    VoiceState.LISTENING -> 500
    else -> 900
}

private fun rotationDurationMs(state: VoiceState): Int = when (state) {
    VoiceState.IDLE -> 24_000
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
