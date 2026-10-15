package com.zarvismobile.core.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * ZARVIS "Aurora Glass" palette.
 *
 * The values are the website's design tokens (web/styles.css, documented in DESIGN_SYSTEM.md), so the app and the site read as one
 * product: the same page and card colours, the same indigo primary in light and the same periwinkle in dark, the same status
 * colours. When a token changes there, change it here (and the other way round).
 *
 * The constants below are the raw palette. Screens should not hard-code them for text: a colour that reads well on the dark page
 * is unreadable on the light one (the cyan below is 1.7:1 on a white card). Text accents and glass surfaces come from
 * [ZarvisExtras] through [LocalZarvisExtras] / [GlassColors] / [ZarvisAccents], which follow the theme.
 */

// ---- Dark ("Dim") -------------------------------------------------------------------------------
val ZarvisSpaceBlack = Color(0xFF070A1D) // web --bg (dim)
val ZarvisSurfaceDark = Color(0xFF0F1436) // web --surface (dim)
val ZarvisSurfaceDarkElevated = Color(0xFF151B45) // web --surface-2 (dim)
val ZarvisSurfaceDarkHighest = Color(0xFF1E2656) // web --surface-3 (dim)
val ZarvisTextPrimaryDark = Color(0xFFF2F4FF) // web --text (dim)
val ZarvisTextSecondaryDark = Color(0xFFC3C9EA) // web --text-2 (dim)
val ZarvisBorderDark = Color(0xFF2B3262) // web --line-2 (dim) over the page
val ZarvisPrimaryDark = Color(0xFF8DA2FF) // web --primary (dim)
val ZarvisErrorDark = Color(0xFFFF7B90) // web --err (dim)
val ZarvisWarningDark = Color(0xFFF0B44C) // web --warn (dim)
val ZarvisSuccessDark = Color(0xFF3CCF95) // web --ok (dim)

// ---- Light ("Aurora Light", the default) --------------------------------------------------------
val ZarvisSurfaceLight = Color(0xFFF4F3FF) // web --bg
val ZarvisSurfaceLightElevated = Color(0xFFFFFFFF) // web --surface
val ZarvisSurfaceLightVariant = Color(0xFFF1F0FD) // web --surface-2
val ZarvisSurfaceLightHighest = Color(0xFFE6E4F8) // web --surface-3
val ZarvisTextPrimaryLight = Color(0xFF0C1222) // web --text
val ZarvisTextSecondaryLight = Color(0xFF424A6B) // web --text-2
val ZarvisBorderLight = Color(0xFFD9DBF0) // web --line-2 over the page
val ZarvisAccentIndigoLight = Color(0xFF4A4DE0) // web --primary
val ZarvisErrorLight = Color(0xFFC42B47) // web --err
val ZarvisWarningLight = Color(0xFF8F5A06) // web --warn
val ZarvisSuccessLight = Color(0xFF09774F) // web --ok

// ---- Brand accents (bright: glows, orbs, gradients, icons on a dark page; not text on a light page) ----
val ZarvisAccentIndigo = Color(0xFF6366F1)
val ZarvisAccentCyan = Color(0xFF22D3EE)
val ZarvisAccentViolet = Color(0xFF8B5CF6)
val ZarvisAccentPink = Color(0xFFF472B6)

/** Risk colours for a dark page (see [ZarvisExtras] for the theme-aware ones that [com.zarvismobile.core.ui.components.RiskBadge] uses). */
object RiskColors {
    val low = ZarvisSuccessDark
    val medium = ZarvisWarningDark
    val high = ZarvisErrorDark
}

object GlowColors {
    val active = ZarvisAccentCyan
    val success = ZarvisSuccessDark
    val warning = ZarvisWarningDark
    val error = ZarvisErrorDark
}

/**
 * Everything that has to change with the theme and is not part of Material's colour scheme: the glass surfaces, their edges, and
 * text-safe accents. Provided by [ZarvisTheme]; read it through [GlassColors], [ZarvisAccents] or [LocalZarvisExtras].
 *
 * Glass is a translucent tint over the aurora page: a pale white veil in light, a faint periwinkle veil in dark. It used to be white
 * in both themes, which made every card, chip and the tab bar a light-grey panel carrying near-white text in dark mode (2:1).
 */
@Immutable
class ZarvisExtras(
    val isDark: Boolean,
    val glass: Color,
    val glassElevated: Color,
    val glassBorder: Color,
    val glassBorderStrong: Color,
    val glassHighlight: Color,
    val accentCyan: Color,
    val accentViolet: Color,
    val accentPink: Color,
    val success: Color,
    val warning: Color,
    val danger: Color,
)

val LightExtras = ZarvisExtras(
    isDark = false,
    glass = Color.White.copy(alpha = 0.72f), // web --glass
    glassElevated = Color.White.copy(alpha = 0.92f),
    glassBorder = Color(0x1A28306E), // web --card-border
    glassBorderStrong = Color(0x333C3C8C), // web --line-2
    glassHighlight = Color.White.copy(alpha = 0.85f),
    accentCyan = Color(0xFF0E7490), // 5.2:1 on a glass card
    accentViolet = Color(0xFF6D4ADF), // 5.5:1
    accentPink = Color(0xFFBE3A86), // 4.9:1
    success = ZarvisSuccessLight,
    warning = ZarvisWarningLight,
    danger = ZarvisErrorLight,
)

val DarkExtras = ZarvisExtras(
    isDark = true,
    glass = Color(0xFFA0AFFF).copy(alpha = 0.075f), // web --card-bg (dim)
    glassElevated = Color(0xFFA0AFFF).copy(alpha = 0.13f),
    glassBorder = Color(0xFFAAB6FF).copy(alpha = 0.15f), // web --card-border (dim)
    glassBorderStrong = Color(0xFFAAB6FF).copy(alpha = 0.26f),
    glassHighlight = Color.White.copy(alpha = 0.07f),
    accentCyan = ZarvisAccentCyan, // 9.9:1 on a dark glass card
    accentViolet = Color(0xFFB49BFF), // web --primary-2 (dim)
    accentPink = Color(0xFFF58FC4),
    success = ZarvisSuccessDark,
    warning = ZarvisWarningDark,
    danger = ZarvisErrorDark,
)

val LocalZarvisExtras = staticCompositionLocalOf { LightExtras }

/** Glass surface colours for the current theme (they were constants; the same names now follow light and dark). */
object GlassColors {
    val surfaceTint: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.glass
    val surfaceTintElevated: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.glassElevated
    val border: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.glassBorder
    val borderStrong: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.glassBorderStrong
    val highlight: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.glassHighlight
}

/** Accent colours that are readable as text and icons on the current theme's page and glass cards (>= 4.5:1). */
object ZarvisAccents {
    val cyan: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.accentCyan
    val violet: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.accentViolet
    val pink: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.accentPink
    val success: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.success
    val warning: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.warning
    val danger: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.danger
}

/**
 * The text-safe version of one of the bright brand accents ([ZarvisAccentCyan], [ZarvisAccentViolet], [ZarvisAccentPink]) for the current
 * theme; any other colour is returned as given. Lets a screen that already passes an accent around keep doing so while its words stay
 * readable on the light page (the bright cyan is 1.7:1 there).
 */
@Composable
@ReadOnlyComposable
fun readableAccent(accent: Color): Color = when (accent) {
    ZarvisAccentCyan -> ZarvisAccents.cyan
    ZarvisAccentViolet -> ZarvisAccents.violet
    ZarvisAccentPink -> ZarvisAccents.pink
    else -> accent
}
