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
 * first, so the number is the one a reader sees. The night page's glows and nebula lights are stacked over the page the same way,
 * at their strongest, because text sits directly on them, and a card's top-lit sheen is laid over the card.
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

    /** The page under each glow, with every nebula light on top: the brightest (or darkest) spots text can land on. */
    private fun decoratedPage(page: Color, sky: QueenSkyColors): Map<String, Color> {
        val spots = mapOf(
            "top glow" to sky.topGlow.compositeOver(page),
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
        "glass card sheen" to LightExtras.glassHighlight.compositeOver(LightExtras.glass.compositeOver(ZarvisSurfaceLight)),
    )

    private val darkSurfaces = decoratedPage(ZarvisSpaceBlack, QueenSkyDark) + mapOf(
        "page" to ZarvisSpaceBlack,
        "surface" to ZarvisSurfaceDark,
        "surface variant" to ZarvisSurfaceDarkElevated,
        "surface highest" to ZarvisSurfaceDarkHighest,
        "glass card" to DarkExtras.glass.compositeOver(ZarvisSpaceBlack),
        "raised glass" to DarkExtras.glassElevated.compositeOver(ZarvisSpaceBlack),
        "glass card sheen" to DarkExtras.glassHighlight.compositeOver(DarkExtras.glass.compositeOver(ZarvisSpaceBlack)),
        "raised glass sheen" to DarkExtras.glassHighlight.compositeOver(DarkExtras.glassElevated.compositeOver(ZarvisSpaceBlack)),
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
            "blue accent" to LightExtras.accentBlue,
            "violet accent" to LightExtras.accentViolet,
            "pink accent" to LightExtras.accentPink,
            "gold accent" to LightExtras.accentGold,
            "primary accent" to LightExtras.accentPrimary,
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
            "blue accent" to DarkExtras.accentBlue,
            "violet accent" to DarkExtras.accentViolet,
            "pink accent" to DarkExtras.accentPink,
            "gold accent" to DarkExtras.accentGold,
            "primary accent" to DarkExtras.accentPrimary,
        ).forEach { (label, colour) -> assertReadable(label, colour, darkSurfaces) }
    }

    @Test
    fun `white is readable on every stop of the action gradient`() {
        listOf(ZarvisActionStart, ZarvisActionMid, ZarvisActionEnd).forEachIndexed { index, stop ->
            assertReadable("white", Color.White, mapOf("action gradient stop $index" to stop))
        }
    }

    @Test
    fun `dark ink is readable on every gold`() {
        // Anything filled with the brand gold (the plan chip on Plans).
        listOf(ZarvisGoldPale, ZarvisGold, ZarvisAmber).forEachIndexed { index, gold ->
            assertReadable("ink on gold", ZarvisInkOnGold, mapOf("gold $index" to gold))
        }
    }

    @Test
    fun `navy ink is readable on the night primary`() {
        // A filled pill in the dark theme's primary (the selected Skills filter, Material's filled buttons and switches).
        assertReadable("ink on primary", ZarvisInkOnPrimaryDark, mapOf("night primary" to ZarvisPrimaryDark))
    }

    @Test
    fun `the bright brand fills are not text colours on the light page`() {
        // They exist for gradients and glows; readableAccent() swaps them for the ink shades when a screen uses one for words.
        listOf(ZarvisAccentCyan, ZarvisAccentPink, ZarvisAccentBlue).forEach { assertTrue(ratio(it, ZarvisSurfaceLightElevated) < 4.5f) }
    }

    @Test
    fun `the palette is the Queen theme's`() {
        // ANDROID_QUEEN_DESIGN.md lists the values (Queen Night since phase 5); the website keeps Aurora Glass until it moves in its own change.
        assertEquals(Color(0xFFFBF4FF), ZarvisSurfaceLight)
        assertEquals(Color(0xFF070A18), ZarvisSpaceBlack)
        assertEquals(Color(0xFF7E22CE), ZarvisAccentIndigoLight)
        assertEquals(Color(0xFFA5B4FC), ZarvisPrimaryDark)
        assertEquals(Color(0xFFFDE68A), DarkExtras.accentGold)
        assertEquals(listOf(Color(0xFF7C3AED), Color(0xFF4F46E5), Color(0xFF2563EB)), listOf(ZarvisActionStart, ZarvisActionMid, ZarvisActionEnd))
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
                "violet" to DarkExtras.accentViolet, "pink" to DarkExtras.accentPink, "blue" to DarkExtras.accentBlue, "neutral" to ZarvisTextSecondaryDark,
                "primary" to DarkExtras.accentPrimary,
            ),
        )
        assertChipsReadable(
            ZarvisSurfaceLight,
            LightExtras.glass.compositeOver(ZarvisSurfaceLight),
            mapOf(
                "active" to LightExtras.accentCyan, "waiting" to LightExtras.warning, "done" to LightExtras.success, "problem" to LightExtras.danger,
                "violet" to LightExtras.accentViolet, "pink" to LightExtras.accentPink, "blue" to LightExtras.accentBlue, "neutral" to ZarvisTextSecondaryLight,
                "primary" to LightExtras.accentPrimary,
            ),
        )
    }

    @Test
    fun `a field's quiet edge is still findable against the page`() {
        // The composer and the search field use the theme's outline (WCAG 1.4.11 asks 3:1 for a control's edge).
        assertReadable("dark outline", Color(0xFF7C86B8), mapOf("page" to ZarvisSpaceBlack, "card" to ZarvisSurfaceDark), minimum = 3f)
        assertReadable("light outline", Color(0xFF7A6A99), mapOf("page" to ZarvisSurfaceLight), minimum = 3f)
    }
}
