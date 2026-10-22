package com.zarvismobile.core.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

/**
 * The colours of the Queen page's decoration ([com.zarvismobile.core.ui.components.ZarvisBackground]), at their strongest: the three
 * still glows, the turning rays, the rising bokeh lights, the falling glitter and the twinkling stars. Text sits directly on the
 * glows, rays and bokeh, so they stay light tints; PaletteContrastTest stacks them over the page and checks every text colour.
 */
@Immutable
internal class QueenSkyColors(
    val topGlow: Color,
    val sideGlow: Color,
    val bottomGlow: Color,
    val ray: Color,
    val bokeh: List<Color>,
    val glitter: List<Color>,
    val star: Color,
)

internal val QueenSkyDark = QueenSkyColors(
    topGlow = ZarvisMagenta.copy(alpha = 0.22f),
    sideGlow = ZarvisAmethyst.copy(alpha = 0.14f),
    bottomGlow = ZarvisGold.copy(alpha = 0.14f),
    ray = ZarvisGold.copy(alpha = 0.10f),
    bokeh = listOf(ZarvisGold.copy(alpha = 0.10f), ZarvisMagenta.copy(alpha = 0.10f), ZarvisAmethyst.copy(alpha = 0.10f)),
    glitter = listOf(ZarvisGoldPale, ZarvisGold, ZarvisRose, ZarvisOrchid, ZarvisAmethyst, Color.White),
    star = ZarvisGoldPale,
)

internal val QueenSkyLight = QueenSkyColors(
    topGlow = ZarvisOrchid.copy(alpha = 0.08f),
    sideGlow = ZarvisAmethyst.copy(alpha = 0.10f),
    bottomGlow = ZarvisGold.copy(alpha = 0.12f),
    ray = ZarvisGold.copy(alpha = 0.12f),
    bokeh = listOf(ZarvisGold.copy(alpha = 0.08f), ZarvisOrchid.copy(alpha = 0.08f), ZarvisAmethyst.copy(alpha = 0.08f)),
    glitter = listOf(ZarvisAmber, ZarvisGold, ZarvisRose, Color(0xFFE879F9), ZarvisAmethyst, ZarvisOrchid),
    star = ZarvisAmber,
)
