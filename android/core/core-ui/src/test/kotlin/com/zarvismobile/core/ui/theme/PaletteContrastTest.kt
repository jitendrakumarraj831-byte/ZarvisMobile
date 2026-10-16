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
 * first, so the number is the one a reader sees.
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

    private val lightSurfaces = mapOf(
        "page" to ZarvisSurfaceLight,
        "surface" to ZarvisSurfaceLightElevated,
        "surface variant" to ZarvisSurfaceLightVariant,
        "surface highest" to ZarvisSurfaceLightHighest,
        "glass card" to LightExtras.glass.compositeOver(ZarvisSurfaceLight),
    )

    private val darkSurfaces = mapOf(
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
        ).forEach { (label, colour) -> assertReadable(label, colour, darkSurfaces) }
    }

    @Test
    fun `white is readable on every stop of the action gradient`() {
        listOf(ZarvisActionBlue, ZarvisActionViolet, ZarvisActionPink).forEachIndexed { index, stop ->
            assertReadable("white", Color.White, mapOf("action gradient stop $index" to stop))
        }
    }

    @Test
    fun `the bright brand fills are not text colours on the light page`() {
        // They exist for gradients and glows; readableAccent() swaps them for the ink shades when a screen uses one for words.
        listOf(ZarvisAccentCyan, ZarvisAccentPink).forEach { assertTrue(ratio(it, ZarvisSurfaceLightElevated) < 4.5f) }
    }

    @Test
    fun `the palette is the website's`() {
        // web/styles.css :root and [data-appearance="dim"]; DESIGN_SYSTEM.md lists the pairs.
        assertEquals(Color(0xFFF6F7FF), ZarvisSurfaceLight)
        assertEquals(Color(0xFF070B1F), ZarvisSpaceBlack)
        assertEquals(Color(0xFF3346D6), ZarvisAccentIndigoLight)
        assertEquals(Color(0xFFA9B6FF), ZarvisPrimaryDark)
    }
}
