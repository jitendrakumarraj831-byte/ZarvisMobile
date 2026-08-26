package com.jarvismobile.core.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val DarkColors = darkColorScheme(
    primary = JarvisAccentIndigo,
    secondary = JarvisAccentCyan,
    background = JarvisSpaceBlack,
    surface = JarvisSurfaceDark,
    surfaceVariant = JarvisSurfaceDarkElevated,
    onBackground = JarvisTextPrimaryDark,
    onSurface = JarvisTextPrimaryDark,
    onSurfaceVariant = JarvisTextSecondaryDark,
    outline = JarvisBorderDark,
    error = JarvisErrorDark,
)

private val LightColors = lightColorScheme(
    primary = JarvisAccentIndigoLight,
    secondary = JarvisAccentCyan,
    background = JarvisSurfaceLight,
    surface = JarvisSurfaceLight,
    surfaceVariant = JarvisSurfaceLightElevated,
    onBackground = JarvisTextPrimaryLight,
    onSurface = JarvisTextPrimaryLight,
    onSurfaceVariant = JarvisTextSecondaryLight,
    outline = JarvisBorderLight,
    error = JarvisErrorLight,
)

/**
 * App-wide theme. Supports dark (default) and light per MASTER_SPEC.md §22; `darkTheme`
 * defaults to the system setting rather than forcing dark, so users who prefer light mode
 * get it automatically.
 */
@Composable
fun JarvisTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColors else LightColors
    MaterialTheme(
        colorScheme = colorScheme,
        typography = JarvisTypography,
        shapes = JarvisShapes,
        content = content,
    )
}
