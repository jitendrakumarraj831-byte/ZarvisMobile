package com.zarvismobile.core.ui.theme

import android.provider.Settings
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

/*
 * Colour roles follow the website (web/styles.css tokens; see Color.kt). The container and outline roles are set on purpose: Material's
 * dialogs, switches and chips read them, and their built-in purple defaults would otherwise be the one off-brand thing on screen.
 */
private val DarkColors = darkColorScheme(
    primary = ZarvisPrimaryDark,
    onPrimary = ZarvisSpaceBlack,
    primaryContainer = Color(0xFF26307A),
    onPrimaryContainer = Color(0xFFE1E6FF),
    secondary = Color(0xFFC9B8FF),
    onSecondary = ZarvisSpaceBlack,
    secondaryContainer = Color(0xFF362C70),
    onSecondaryContainer = Color(0xFFE9E1FF),
    tertiary = Color(0xFFF9A8D4),
    onTertiary = ZarvisSpaceBlack,
    background = ZarvisSpaceBlack,
    onBackground = ZarvisTextPrimaryDark,
    surface = ZarvisSurfaceDark,
    onSurface = ZarvisTextPrimaryDark,
    surfaceVariant = ZarvisSurfaceDarkElevated,
    onSurfaceVariant = ZarvisTextSecondaryDark,
    surfaceContainerLowest = ZarvisSpaceBlack,
    surfaceContainerLow = Color(0xFF0B1029),
    surfaceContainer = ZarvisSurfaceDark,
    surfaceContainerHigh = ZarvisSurfaceDarkElevated,
    surfaceContainerHighest = ZarvisSurfaceDarkHighest,
    outline = Color(0xFF6E79B3),
    outlineVariant = ZarvisBorderDark,
    error = ZarvisErrorDark,
    onError = ZarvisSpaceBlack,
    errorContainer = Color(0xFF5A1426),
    onErrorContainer = Color(0xFFFFD9DF),
)

private val LightColors = lightColorScheme(
    primary = ZarvisAccentIndigoLight,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE2E5FF),
    onPrimaryContainer = Color(0xFF17206B),
    secondary = ZarvisActionViolet,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFEDE5FF),
    onSecondaryContainer = Color(0xFF2E1065),
    tertiary = ZarvisActionPink,
    onTertiary = Color.White,
    background = ZarvisSurfaceLight,
    onBackground = ZarvisTextPrimaryLight,
    surface = ZarvisSurfaceLightElevated,
    onSurface = ZarvisTextPrimaryLight,
    surfaceVariant = ZarvisSurfaceLightVariant,
    onSurfaceVariant = ZarvisTextSecondaryLight,
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFF9FAFF),
    surfaceContainer = ZarvisSurfaceLightVariant,
    surfaceContainerHigh = Color(0xFFEDEFFD),
    surfaceContainerHighest = ZarvisSurfaceLightHighest,
    outline = Color(0xFF6B7194),
    outlineVariant = ZarvisBorderLight,
    error = ZarvisErrorLight,
    onError = Color.White,
    errorContainer = Color(0xFFFDE4E1),
    onErrorContainer = Color(0xFF6B0F14),
)

@Composable
fun ZarvisTheme(darkTheme: Boolean = false, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalZarvisExtras provides (if (darkTheme) DarkExtras else LightExtras)) {
        MaterialTheme(
            colorScheme = if (darkTheme) DarkColors else LightColors,
            typography = ZarvisTypography,
            shapes = ZarvisShapes,
            content = content,
        )
    }
}

/**
 * True when the person (or the phone's battery saver, through "Remove animations" or an animator scale of 0) has turned animation off.
 * Read once per composition: the setting does not change while a screen is showing. Every looping animation in the app asks this
 * first and holds still instead of running, so a tester or a low-end phone is not repainting a decoration all day.
 */
@Composable
@ReadOnlyComposable
fun zarvisReduceMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return runCatching { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)
}

/** Decoration only (rings, edges, progress, the orb): cyan → blue → violet → pink, the website's `--grad-aurora`. Never under text. */
fun zarvisAuroraBrush() = Brush.linearGradient(
    colors = listOf(ZarvisAccentCyan, ZarvisAccentBlue, ZarvisAccentViolet, ZarvisAccentPink),
)

/** The fill under white text and icons (primary buttons, the sent message): blue → violet → pink, the website's `--grad`. */
fun zarvisActionBrush() = Brush.linearGradient(
    colors = listOf(ZarvisActionBlue, ZarvisActionViolet, ZarvisActionPink),
)
