package com.zarvismobile.core.ui.theme

import android.provider.Settings
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

/*
 * Colour roles for the Queen theme (see Color.kt): Queen Night (navy, periwinkle, violet and blue light) and Queen Light. The container and outline roles are set on purpose: Material's dialogs, switches
 * and chips read them, and their built-in purple defaults would otherwise be the one off-brand thing on screen.
 */
private val DarkColors = darkColorScheme(
    primary = ZarvisPrimaryDark,
    onPrimary = ZarvisInkOnPrimaryDark,
    primaryContainer = Color(0xFF27305F),
    onPrimaryContainer = Color(0xFFE0E7FF),
    secondary = ZarvisNightLavender,
    onSecondary = Color(0xFF1E1240),
    secondaryContainer = Color(0xFF3B2A7A),
    onSecondaryContainer = Color(0xFFEDE9FE),
    tertiary = Color(0xFF93C5FD),
    onTertiary = Color(0xFF0B1E3F),
    background = ZarvisSpaceBlack,
    onBackground = ZarvisTextPrimaryDark,
    surface = ZarvisSurfaceDark,
    onSurface = ZarvisTextPrimaryDark,
    surfaceVariant = ZarvisSurfaceDarkElevated,
    onSurfaceVariant = ZarvisTextSecondaryDark,
    surfaceContainerLowest = ZarvisSpaceBlack,
    surfaceContainerLow = Color(0xFF0B0E20),
    surfaceContainer = ZarvisSurfaceDark,
    surfaceContainerHigh = ZarvisSurfaceDarkElevated,
    surfaceContainerHighest = ZarvisSurfaceDarkHighest,
    outline = Color(0xFF7C86B8),
    outlineVariant = ZarvisBorderDark,
    error = ZarvisErrorDark,
    onError = Color(0xFF4C0519),
    errorContainer = Color(0xFF4A1426),
    onErrorContainer = Color(0xFFFFD9DF),
)

private val LightColors = lightColorScheme(
    primary = ZarvisAccentIndigoLight,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFF3E8FF),
    onPrimaryContainer = Color(0xFF3B0764),
    secondary = ZarvisActionMid,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFFCE7F3),
    onSecondaryContainer = Color(0xFF500724),
    tertiary = ZarvisActionEnd,
    onTertiary = Color.White,
    background = ZarvisSurfaceLight,
    onBackground = ZarvisTextPrimaryLight,
    surface = ZarvisSurfaceLightElevated,
    onSurface = ZarvisTextPrimaryLight,
    surfaceVariant = ZarvisSurfaceLightVariant,
    onSurfaceVariant = ZarvisTextSecondaryLight,
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFFDF9FF),
    surfaceContainer = ZarvisSurfaceLightVariant,
    surfaceContainerHigh = Color(0xFFF6EDFE),
    surfaceContainerHighest = ZarvisSurfaceLightHighest,
    outline = Color(0xFF7A6A99),
    outlineVariant = ZarvisBorderLight,
    error = ZarvisErrorLight,
    onError = Color.White,
    errorContainer = Color(0xFFFDE4E1),
    onErrorContainer = Color(0xFF6B0F14),
)

/** True while Lightweight mode is on (Settings > Appearance): every looping animation holds still, as with "Remove animations". */
val LocalZarvisLightweight = staticCompositionLocalOf { false }

@Composable
fun ZarvisTheme(darkTheme: Boolean = true, lightweight: Boolean = false, content: @Composable () -> Unit) {
    CompositionLocalProvider(
        LocalZarvisExtras provides (if (darkTheme) DarkExtras else LightExtras),
        LocalZarvisLightweight provides lightweight,
    ) {
        MaterialTheme(
            colorScheme = if (darkTheme) DarkColors else LightColors,
            typography = ZarvisTypography,
            shapes = ZarvisShapes,
            content = content,
        )
    }
}

/**
 * True when the person (or the phone's battery saver, through "Remove animations" or an animator scale of 0) has turned animation off,
 * or has turned on ZARVIS's own Lightweight mode. Every looping animation in the app asks this first and holds still instead of
 * running, so a tester or a low-end phone is not repainting a decoration all day.
 */
@Composable
@ReadOnlyComposable
fun zarvisReduceMotion(): Boolean {
    if (LocalZarvisLightweight.current) return true
    val resolver = LocalContext.current.contentResolver
    return runCatching { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)
}

/** Decoration only (rings, edges, progress meters, the tab indicator): lavender → violet → blue, the night's lights. Never under text. */
fun zarvisAuroraBrush() = Brush.linearGradient(
    colors = listOf(ZarvisNightLavender, ZarvisAccentViolet, ZarvisAccentBlue, ZarvisNightSky),
)

/** The fill under white text and icons (primary buttons, the sent message): violet → indigo → blue, at least 4.5:1 with white. */
fun zarvisActionBrush() = Brush.linearGradient(
    colors = listOf(ZarvisActionStart, ZarvisActionMid, ZarvisActionEnd),
)
