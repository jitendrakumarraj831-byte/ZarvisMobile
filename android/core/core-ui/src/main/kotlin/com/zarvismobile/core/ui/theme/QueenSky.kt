package com.zarvismobile.core.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

/**
 * The colours of the night page's decoration ([com.zarvismobile.core.ui.components.ZarvisBackground]), at their strongest: the three
 * still glows, the slowly drifting nebula lights and the twinkling stars. Text sits directly on the glows and the nebula lights, so
 * they stay light tints; PaletteContrastTest stacks them over the page and checks every text colour.
 */
@Immutable
internal class QueenSkyColors(
    val topGlow: Color,
    val sideGlow: Color,
    val bottomGlow: Color,
    val bokeh: List<Color>,
    val star: Color,
)

internal val QueenSkyDark = QueenSkyColors(
    topGlow = ZarvisAccentViolet.copy(alpha = 0.26f),
    sideGlow = ZarvisAccentBlue.copy(alpha = 0.16f),
    bottomGlow = ZarvisNightIndigo.copy(alpha = 0.16f),
    bokeh = listOf(ZarvisAccentViolet.copy(alpha = 0.10f), ZarvisAccentBlue.copy(alpha = 0.10f), ZarvisNightIndigo.copy(alpha = 0.10f)),
    star = ZarvisNightIce,
)

internal val QueenSkyLight = QueenSkyColors(
    topGlow = ZarvisAccentViolet.copy(alpha = 0.10f),
    sideGlow = ZarvisAccentBlue.copy(alpha = 0.08f),
    bottomGlow = ZarvisNightIndigo.copy(alpha = 0.10f),
    bokeh = listOf(ZarvisAccentViolet.copy(alpha = 0.07f), ZarvisAccentBlue.copy(alpha = 0.07f), ZarvisNightIndigo.copy(alpha = 0.07f)),
    star = ZarvisAccentViolet,
)
