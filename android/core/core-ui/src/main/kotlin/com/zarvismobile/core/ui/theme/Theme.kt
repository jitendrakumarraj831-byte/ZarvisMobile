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
 * Colour roles for the Queen theme (see Color.kt). The container and outline roles are set on purpose: Material's dialogs, switches
 * and chips read them, and their built-in purple defaults would otherwise be the one off-brand thing on screen.
 */
private val DarkColors = darkColorScheme(
    primary = ZarvisPrimaryDark,
    onPrimary = ZarvisInkOnGold,
    primaryContainer = Color(0xFF5B2A12),
    onPrimaryContainer = Color(0xFFFFF1C7),
    secondary = Color(0xFFE9D5FF),
    onSecondary = Color(0xFF2E1065),
    secondaryContainer = Color(0xFF4C1D95),
    onSecondaryContainer = Color(0xFFF3E8FF),
    tertiary = Color(0xFFF9A8D4),
    onTertiary = Color(0xFF500724),
    background = ZarvisSpaceBlack,
    onBackground = ZarvisTextPrimaryDark,
    surface = ZarvisSurfaceDark,
    onSurface = ZarvisTextPrimaryDark,
    surfaceVariant = ZarvisSurfaceDarkElevated,
    onSurfaceVariant = ZarvisTextSecondaryDark,
    surfaceContainerLowest = ZarvisSpaceBlack,
    surfaceContainerLow = Color(0xFF1A0727),
    surfaceContainer = ZarvisSurfaceDark,
    surfaceContainerHigh = ZarvisSurfaceDarkElevated,
    surfaceContainerHighest = ZarvisSurfaceDarkHighest,
    outline = Color(0xFF9C7AB3),
    outlineVariant = ZarvisBorderDark,
    error = ZarvisErrorDark,
    onError = Color(0xFF4C0519),
    errorContainer = Color(0xFF5A1426),
    onErrorContainer = Color(0xFFFFD9DF),
)

private val LightColors = lightColorScheme(
    primary = ZarvisAccentIndigoLight,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFF3E8FF),
    onPrimaryContainer = Color(0xFF3B0764),
    secondary = ZarvisActionViolet,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFFCE7F3),
    onSecondaryContainer = Color(0xFF500724),
    tertiary = ZarvisActionPink,
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

/** Decoration only (rings, edges, progress, the orb): gold → orchid → amethyst → rose, the Queen jewels. Never under text. */
fun zarvisAuroraBrush() = Brush.linearGradient(
    colors = listOf(ZarvisGold, ZarvisOrchid, ZarvisAmethyst, ZarvisRose),
)

/** The fill under white text and icons (primary buttons, the sent message): royal purple → rose → amber, at least 4.5:1 with white. */
fun zarvisActionBrush() = Brush.linearGradient(
    colors = listOf(ZarvisActionBlue, ZarvisActionViolet, ZarvisActionPink),
)
