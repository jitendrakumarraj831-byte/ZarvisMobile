package com.zarvismobile.core.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.LocalZarvisExtras
import com.zarvismobile.core.ui.theme.QueenSkyColors
import com.zarvismobile.core.ui.theme.QueenSkyDark
import com.zarvismobile.core.ui.theme.QueenSkyLight
import com.zarvismobile.core.ui.theme.zarvisReduceMotion
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin
import kotlin.random.Random

/**
 * The Queen page (ANDROID_QUEEN_DESIGN.md). Every page is a navy-black night (lavender in the light theme) with one soft violet glow
 * at the top. Queen Pro keeps the full scene for Home alone ([decorated]): blue light on the right and indigo at the bottom, and over
 * it a few nebula lights drifting slowly upwards and twinkling four-point stars. Inner pages stay quiet so their text and controls are
 * what you see.
 *
 * Speed: the three glows are painted once per size or theme change. Everything that moves lives on its own layer behind the
 * content and runs off one clock that is read while drawing, so a frame repaints only that layer: no recomposition, no
 * relayout, and the screen's text and cards are not redrawn. The scene holds still (one fixed frame) when Android's animations
 * are off, and Android stops sending frames while the app is in the background.
 *
 * The decoration never sits under text at more than a light tint ([QueenSkyDark], [QueenSkyLight]): even where the top glow and a
 * nebula light overlap, every text colour keeps 4.5:1 (PaletteContrastTest stacks them to check).
 */
@Composable
fun ZarvisBackground(modifier: Modifier = Modifier, decorated: Boolean = false, content: @Composable BoxScope.() -> Unit) {
    val base = MaterialTheme.colorScheme.background
    val sky = if (LocalZarvisExtras.current.isDark) QueenSkyDark else QueenSkyLight
    Box(
        modifier = modifier.fillMaxSize().background(base).drawBehind {
            val reach = size.maxDimension
            if (decorated) {
                drawRect(Brush.radialGradient(listOf(sky.topGlow, Color.Transparent), Offset(size.width * .5f, size.height * .12f), reach * .55f))
                drawRect(Brush.radialGradient(listOf(sky.sideGlow, Color.Transparent), Offset(size.width, size.height * .42f), reach * .5f))
                drawRect(Brush.radialGradient(listOf(sky.bottomGlow, Color.Transparent), Offset(size.width * .2f, size.height * 1.04f), reach * .6f))
            } else {
                // One glow, centred above the top edge, that fades out before the first section.
                drawRect(Brush.radialGradient(listOf(sky.topGlow, Color.Transparent), Offset(size.width * .5f, -size.width * .2f), size.width * .9f))
            }
        },
    ) {
        if (decorated) QueenSky(sky = sky, still = zarvisReduceMotion(), modifier = Modifier.matchParentSize())
        content()
    }
}

/** One full cycle of the scene: every motion repeats a whole number of times inside it, so the loop has no seam. */
private const val CYCLE_MS = 60_000

/** The moment of the cycle drawn when motion is off: nebula lights spread over the screen, some stars lit. */
private const val STILL_AT = 0.37f

@Composable
private fun QueenSky(sky: QueenSkyColors, still: Boolean, modifier: Modifier) {
    val clock: State<Float>? = if (still) {
        null
    } else {
        rememberInfiniteTransition(label = "queen-sky").animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(durationMillis = CYCLE_MS, easing = LinearEasing)),
            label = "queen-sky-clock",
        )
    }
    Spacer(
        modifier.graphicsLayer().drawWithCache {
            val star = Path().apply {
                moveTo(0f, -1f)
                lineTo(.22f, -.22f)
                lineTo(1f, 0f)
                lineTo(.22f, .22f)
                lineTo(0f, 1f)
                lineTo(-.22f, .22f)
                lineTo(-1f, 0f)
                lineTo(-.22f, -.22f)
                close()
            }
            val unit = 1.dp.toPx()
            val bokehBrushes = Bokeh.map { b ->
                val color = sky.bokeh[b.color % sky.bokeh.size]
                Brush.radialGradient(listOf(color, color.copy(alpha = 0f)), Offset.Zero, b.radiusDp * unit)
            }

            onDrawBehind {
                val t = clock?.value ?: STILL_AT
                val w = size.width
                val h = size.height

                Bokeh.forEachIndexed { i, b ->
                    val r = b.radiusDp * unit
                    val y = h + r - (fraction(t * b.laps + b.phase) * (h + 2 * r))
                    val x = w * b.x + w * .04f * sin(TAU * (t * b.laps * 2 + b.phase))
                    translate(x, y) { drawCircle(bokehBrushes[i], radius = r, center = Offset.Zero) }
                }

                Dust.forEach { d ->
                    // Fine starlight: always there, brightening and dimming slowly.
                    val glow = .35f + .35f * sin(TAU * (t * d.laps + d.phase))
                    drawCircle(sky.star.copy(alpha = glow), radius = d.sizeDp * unit * .5f, center = Offset(w * d.x, h * d.y))
                }

                Stars.forEach { st ->
                    val glow = .5f - .5f * cos(TAU * (t * st.laps + st.phase))
                    if (glow > .02f) {
                        val s = st.sizeDp * unit * (.3f + .7f * glow)
                        withTransform({
                            translate(w * st.x, h * st.y)
                            rotate(degrees = 90f * glow, pivot = Offset.Zero)
                            scale(s, s, pivot = Offset.Zero)
                        }) { drawPath(star, sky.star.copy(alpha = glow)) }
                    }
                }
            }
        },
    )
}

private const val TAU = (2.0 * PI).toFloat()

private fun fraction(v: Float): Float = v - floor(v)

/** A speck of starlight at a fixed spot that brightens and dims [laps] times per cycle. */
private class Speck(val x: Float, val y: Float, val phase: Float, val laps: Int, val sizeDp: Float)

/** A four-point star at a fixed spot that twinkles [laps] times per cycle. */
private class Star(val x: Float, val y: Float, val phase: Float, val laps: Int, val sizeDp: Float)

/** A large soft nebula light drifting up from the bottom. */
private class Bubble(val x: Float, val phase: Float, val laps: Int, val radiusDp: Float, val color: Int)

// Fixed seeds: the same sky on every launch, so coming back to Home does not reshuffle it.
private val Dust: List<Speck> = Random(11).let { r ->
    List(22) {
        Speck(
            x = r.nextFloat(),
            y = r.nextFloat() * .85f,
            phase = r.nextFloat(),
            laps = 3 + r.nextInt(4), // a slow shimmer every 10–20 seconds
            sizeDp = 1.2f + r.nextFloat() * 1.6f,
        )
    }
}

private val Stars: List<Star> = Random(23).let { r ->
    List(6) {
        Star(
            x = .06f + r.nextFloat() * .88f,
            y = .04f + r.nextFloat() * .7f,
            phase = r.nextFloat(),
            laps = 12 + r.nextInt(8), // a twinkle every 3–5 seconds
            sizeDp = 4f + r.nextFloat() * 4f,
        )
    }
}

private val Bokeh: List<Bubble> = Random(5).let { r ->
    List(4) { i ->
        Bubble(x = .1f + r.nextFloat() * .8f, phase = r.nextFloat(), laps = 1, radiusDp = 60f + r.nextFloat() * 50f, color = i)
    }
}
