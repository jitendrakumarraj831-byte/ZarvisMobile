package com.zarvismobile.core.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush

private val DarkColors = darkColorScheme(
    primary = ZarvisAccentCyan,
    onPrimary = ZarvisSpaceBlack,
    secondary = ZarvisAccentViolet,
    onSecondary = Color.White,
    tertiary = ZarvisAccentPink,
    onTertiary = Color.White,
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
    onPrimary = Color.White,
    secondary = ZarvisAccentCyan,
    onSecondary = ZarvisSpaceBlack,
    tertiary = ZarvisAccentPink,
    onTertiary = Color.White,
    background = ZarvisSurfaceLight,
    surface = ZarvisSurfaceLightElevated,
    surfaceVariant = Color(0xFFF0F4FF),
    onBackground = ZarvisTextPrimaryLight,
    onSurface = ZarvisTextPrimaryLight,
    onSurfaceVariant = ZarvisTextSecondaryLight,
    outline = ZarvisBorderLight,
    error = ZarvisErrorLight,
    onError = Color.White,
)

/** Aurora Glass app theme. Light mode is the default and remains user-switchable. */
@Composable
fun ZarvisTheme(
    darkTheme: Boolean = false,
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = ZarvisTypography,
        shapes = ZarvisShapes,
        content = content,
    )
}

/** Reusable aurora gradient for highlights and icon surfaces. */
fun zarvisAuroraBrush() = Brush.linearGradient(
    colors = listOf(ZarvisAccentCyan, ZarvisAccentIndigo, ZarvisAccentViolet, ZarvisAccentPink),
)
