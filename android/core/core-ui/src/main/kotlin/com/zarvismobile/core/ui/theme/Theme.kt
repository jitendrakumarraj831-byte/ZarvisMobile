package com.zarvismobile.core.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColors = darkColorScheme(
    primary = ZarvisAccentCyan,
    onPrimary = ZarvisSpaceBlack,
    secondary = ZarvisAccentIndigo,
    onSecondary = Color.White,
    tertiary = ZarvisSuccessDark,
    onTertiary = ZarvisSpaceBlack,
    background = ZarvisSpaceBlack,
    surface = ZarvisSurfaceDark,
    surfaceVariant = ZarvisSurfaceDarkElevated,
    onBackground = ZarvisTextPrimaryDark,
    onSurface = ZarvisTextPrimaryDark,
    onSurfaceVariant = ZarvisTextSecondaryDark,
    outline = ZarvisBorderDark,
    error = ZarvisErrorDark,
    onError = Color.White,
)

private val LightColors = lightColorScheme(
    primary = ZarvisAccentIndigoLight,
    secondary = ZarvisAccentCyan,
    tertiary = ZarvisSuccessLight,
    background = ZarvisSurfaceLight,
    surface = ZarvisSurfaceLight,
    surfaceVariant = ZarvisSurfaceLightElevated,
    onBackground = ZarvisTextPrimaryLight,
    onSurface = ZarvisTextPrimaryLight,
    onSurfaceVariant = ZarvisTextSecondaryLight,
    outline = ZarvisBorderLight,
    error = ZarvisErrorLight,
)

/**
 * App-wide theme. Supports dark (default, "Zarvis Cyber Luxury") and light per
 * MASTER_SPEC.md §22; `darkTheme` defaults to the system setting rather than forcing dark,
 * so users who prefer light mode get it automatically.
 */
@Composable
fun ZarvisTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColors else LightColors
    MaterialTheme(
        colorScheme = colorScheme,
        typography = ZarvisTypography,
        shapes = ZarvisShapes,
        content = content,
    )
}
