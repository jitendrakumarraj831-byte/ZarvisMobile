package com.zarvismobile.core.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Android twin of web/tests/contrast.test.js: every text colour of the palette is at least 4.5:1 on every surface it is drawn on,
 * in light and dark, and white is at least 4.5:1 on every stop of the action gradient. Translucent glass is blended over the page
 * first, so the number is the one a reader sees. The Queen page's glows, rays and bokeh are stacked over the page the same way, at
 * their strongest, because text sits directly on them.
 */
class PaletteContrastTest {
    private fun ratio(a: Color, b: Color): Float {
        val (hi, lo) = listOf(a.luminance(), b.luminance()).sortedDescending()
        return (hi + 0.05f) / (lo + 0.05f)
    }

    private fun assertReadable(label: String, text: Color, surfaces: Map<String, Color>, minimum: Float = 4.5f) {
        val failures = surfaces.mapNotNull { (name, surface) ->
            val r = ratio(text, surface)
            if (r < minimum) "$label on $name: ${"%.2f".format(r)}" else null
        }
        assertTrue(failures.joinToString("; "), failures.isEmpty())
    }

    /** The page under each glow, with the rays and every bokeh colour on top: the brightest (or darkest) spots text can land on. */
    private fun decoratedPage(page: Color, sky: QueenSkyColors): Map<String, Color> {
        val spots = mapOf(
            "top glow + rays" to sky.ray.compositeOver(sky.topGlow.compositeOver(page)),
            "side glow" to sky.sideGlow.compositeOver(page),
            "bottom glow" to sky.bottomGlow.compositeOver(page),
        )
        return spots + spots.flatMap { (name, spot) -> sky.bokeh.mapIndexed { i, light -> "$name + bokeh $i" to light.compositeOver(spot) } }
    }

    private val lightSurfaces = decoratedPage(ZarvisSurfaceLight, QueenSkyLight) + mapOf(
        "page" to ZarvisSurfaceLight,
        "surface" to ZarvisSurfaceLightElevated,
        "surface variant" to ZarvisSurfaceLightVariant,
        "surface highest" to ZarvisSurfaceLightHighest,
        "glass card" to LightExtras.glass.compositeOver(ZarvisSurfaceLight),
    )

    private val darkSurfaces = decoratedPage(ZarvisSpaceBlack, QueenSkyDark) + mapOf(
        "page" to ZarvisSpaceBlack,
        "surface" to ZarvisSurfaceDark,
        "surface variant" to ZarvisSurfaceDarkElevated,
        "surface highest" to ZarvisSurfaceDarkHighest,
        "glass card" to DarkExtras.glass.compositeOver(ZarvisSpaceBlack),
        "raised glass" to DarkExtras.glassElevated.compositeOver(ZarvisSpaceBlack),
    )

    @Test
    fun `light text colours are readable on every light surface`() {
        mapOf(
            "text" to ZarvisTextPrimaryLight,
            "secondary text" to ZarvisTextSecondaryLight,
            "primary" to ZarvisAccentIndigoLight,
            "error" to ZarvisErrorLight,
            "warning" to ZarvisWarningLight,
            "success" to ZarvisSuccessLight,
            "cyan accent" to LightExtras.accentCyan,
            "violet accent" to LightExtras.accentViolet,
            "pink accent" to LightExtras.accentPink,
            "gold accent" to LightExtras.accentGold,
        ).forEach { (label, colour) -> assertReadable(label, colour, lightSurfaces) }
    }

    @Test
    fun `dark text colours are readable on every dark surface`() {
        mapOf(
            "text" to ZarvisTextPrimaryDark,
            "secondary text" to ZarvisTextSecondaryDark,
            "primary" to ZarvisPrimaryDark,
            "error" to ZarvisErrorDark,
            "warning" to ZarvisWarningDark,
            "success" to ZarvisSuccessDark,
            "cyan accent" to DarkExtras.accentCyan,
            "violet accent" to DarkExtras.accentViolet,
            "pink accent" to DarkExtras.accentPink,
            "gold accent" to DarkExtras.accentGold,
        ).forEach { (label, colour) -> assertReadable(label, colour, darkSurfaces) }
    }

    @Test
    fun `white is readable on every stop of the action gradient`() {
        listOf(ZarvisActionBlue, ZarvisActionViolet, ZarvisActionPink).forEachIndexed { index, stop ->
            assertReadable("white", Color.White, mapOf("action gradient stop $index" to stop))
        }
    }

    @Test
    fun `dark ink is readable on every gold`() {
        // The dark theme's buttons (gold primary) and the middle tab's orb.
        listOf(ZarvisGoldPale, ZarvisGold, ZarvisAmber, ZarvisPrimaryDark).forEachIndexed { index, gold ->
            assertReadable("ink on gold", ZarvisInkOnGold, mapOf("gold $index" to gold))
        }
    }

    @Test
    fun `the bright brand fills are not text colours on the light page`() {
        // They exist for gradients and glows; readableAccent() swaps them for the ink shades when a screen uses one for words.
        listOf(ZarvisAccentCyan, ZarvisAccentPink).forEach { assertTrue(ratio(it, ZarvisSurfaceLightElevated) < 4.5f) }
    }

    @Test
    fun `the palette is the Queen theme's`() {
        // ANDROID_QUEEN_DESIGN.md lists the values; the website keeps Aurora Glass until it moves in its own change.
        assertEquals(Color(0xFFFBF4FF), ZarvisSurfaceLight)
        assertEquals(Color(0xFF14041F), ZarvisSpaceBlack)
        assertEquals(Color(0xFF7E22CE), ZarvisAccentIndigoLight)
        assertEquals(Color(0xFFFDE68A), ZarvisPrimaryDark)
        assertEquals(listOf(Color(0xFF7E22CE), Color(0xFFBE185D), Color(0xFFB45309)), listOf(ZarvisActionBlue, ZarvisActionViolet, ZarvisActionPink))
    }

    /** A status or risk chip (TintPill): the accent as text on a 14% wash of itself, over the page and over a card. */
    private fun assertChipsReadable(page: Color, card: Color, accents: Map<String, Color>) {
        for ((label, accent) in accents) {
            val wash = accent.copy(alpha = 0.14f)
            assertReadable("$label chip", accent, mapOf("chip on page" to wash.compositeOver(page), "chip on card" to wash.compositeOver(card)))
        }
    }

    @Test
    fun `status and risk chips are readable on their own tint in both themes`() {
        assertChipsReadable(
            ZarvisSpaceBlack,
            DarkExtras.glass.compositeOver(ZarvisSpaceBlack),
            mapOf(
                "active" to DarkExtras.accentCyan, "waiting" to DarkExtras.warning, "done" to DarkExtras.success, "problem" to DarkExtras.danger,
                "violet" to DarkExtras.accentViolet, "pink" to DarkExtras.accentPink, "neutral" to ZarvisTextSecondaryDark,
            ),
        )
        assertChipsReadable(
            ZarvisSurfaceLight,
            LightExtras.glass.compositeOver(ZarvisSurfaceLight),
            mapOf(
                "active" to LightExtras.accentCyan, "waiting" to LightExtras.warning, "done" to LightExtras.success, "problem" to LightExtras.danger,
                "violet" to LightExtras.accentViolet, "pink" to LightExtras.accentPink, "neutral" to ZarvisTextSecondaryLight,
            ),
        )
    }

    @Test
    fun `a field's quiet edge is still findable against the page`() {
        // The composer and the search field use the theme's outline (WCAG 1.4.11 asks 3:1 for a control's edge).
        assertReadable("dark outline", Color(0xFF9C7AB3), mapOf("page" to ZarvisSpaceBlack), minimum = 3f)
        assertReadable("light outline", Color(0xFF7A6A99), mapOf("page" to ZarvisSurfaceLight), minimum = 3f)
    }
}
