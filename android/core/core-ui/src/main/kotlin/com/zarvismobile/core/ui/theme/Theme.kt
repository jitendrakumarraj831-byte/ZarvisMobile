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
    secondary = Color(0xFFB49BFF),
    onSecondary = ZarvisSpaceBlack,
    secondaryContainer = Color(0xFF362C70),
    onSecondaryContainer = Color(0xFFE9E1FF),
    tertiary = Color(0xFFF58FC4),
    onTertiary = ZarvisSpaceBlack,
    background = ZarvisSpaceBlack,
    onBackground = ZarvisTextPrimaryDark,
    surface = ZarvisSurfaceDark,
    onSurface = ZarvisTextPrimaryDark,
    surfaceVariant = ZarvisSurfaceDarkElevated,
    onSurfaceVariant = ZarvisTextSecondaryDark,
    surfaceContainerLowest = ZarvisSpaceBlack,
    surfaceContainerLow = Color(0xFF0B0F2B),
    surfaceContainer = ZarvisSurfaceDark,
    surfaceContainerHigh = ZarvisSurfaceDarkElevated,
    surfaceContainerHighest = ZarvisSurfaceDarkHighest,
    outline = Color(0xFF6B76AD),
    outlineVariant = ZarvisBorderDark,
    error = ZarvisErrorDark,
    onError = ZarvisSpaceBlack,
    errorContainer = Color(0xFF5A1426),
    onErrorContainer = Color(0xFFFFD9DF),
)

private val LightColors = lightColorScheme(
    primary = ZarvisAccentIndigoLight,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE3E4FF),
    onPrimaryContainer = Color(0xFF1B1D75),
    secondary = Color(0xFF6D4ADF),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFEBE4FF),
    onSecondaryContainer = Color(0xFF2E1A78),
    tertiary = Color(0xFFBE3A86),
    onTertiary = Color.White,
    background = ZarvisSurfaceLight,
    onBackground = ZarvisTextPrimaryLight,
    surface = ZarvisSurfaceLightElevated,
    onSurface = ZarvisTextPrimaryLight,
    surfaceVariant = ZarvisSurfaceLightVariant,
    onSurfaceVariant = ZarvisTextSecondaryLight,
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFF8F7FF),
    surfaceContainer = ZarvisSurfaceLightVariant,
    surfaceContainerHigh = Color(0xFFECEAFB),
    surfaceContainerHighest = ZarvisSurfaceLightHighest,
    outline = Color(0xFF6B7194),
    outlineVariant = ZarvisBorderLight,
    error = ZarvisErrorLight,
    onError = Color.White,
    errorContainer = Color(0xFFFFE1E6),
    onErrorContainer = Color(0xFF6B0F24),
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

fun zarvisAuroraBrush() = Brush.linearGradient(
    colors = listOf(ZarvisAccentCyan, ZarvisAccentIndigo, ZarvisAccentViolet),
)
