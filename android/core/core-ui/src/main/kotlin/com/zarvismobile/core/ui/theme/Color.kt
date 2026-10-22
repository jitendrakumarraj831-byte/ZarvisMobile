package com.zarvismobile.core.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * ZARVIS "Queen" palette: a deep plum night with gold, rose and amethyst light, and a lavender day version.
 *
 * Queen Dark is the default appearance; Queen Light is the same theme for daylight. The design (every Android screen, the motion
 * and the speed rules) is in ANDROID_QUEEN_DESIGN.md. The website still uses the Aurora Glass palette (DESIGN_SYSTEM.md) until it
 * moves to Queen in its own change.
 *
 * The constants below are the raw palette. Screens should not hard-code them for text: a colour that reads well on the dark page
 * is unreadable on the light one (the bright cyan below is 2.4:1 on a white card). Text accents and glass surfaces come from
 * [ZarvisExtras] through [LocalZarvisExtras] / [GlassColors] / [ZarvisAccents], which follow the theme.
 */

// ---- Dark ("Queen Dark", the default) -----------------------------------------------------------
val ZarvisSpaceBlack = Color(0xFF14041F) // plum night page
val ZarvisSurfaceDark = Color(0xFF200A30)
val ZarvisSurfaceDarkElevated = Color(0xFF2A0F3D)
val ZarvisSurfaceDarkHighest = Color(0xFF36154D)
val ZarvisTextPrimaryDark = Color(0xFFFFF7FB)
val ZarvisTextSecondaryDark = Color(0xFFECD3F5)
val ZarvisBorderDark = Color(0xFF4A2A5E)
val ZarvisPrimaryDark = Color(0xFFFDE68A) // gold: the selected tab, focus, links
val ZarvisErrorDark = Color(0xFFFDA4AF)
val ZarvisWarningDark = Color(0xFFFCD34D)
val ZarvisSuccessDark = Color(0xFF86EFAC)

// ---- Light ("Queen Light") ----------------------------------------------------------------------
val ZarvisSurfaceLight = Color(0xFFFBF4FF) // lavender page
val ZarvisSurfaceLightElevated = Color(0xFFFFFFFF)
val ZarvisSurfaceLightVariant = Color(0xFFF8F0FF)
val ZarvisSurfaceLightHighest = Color(0xFFF4E9FD)
val ZarvisTextPrimaryLight = Color(0xFF1A0B3B)
val ZarvisTextSecondaryLight = Color(0xFF4C3D75)
val ZarvisBorderLight = Color(0xFFE2CFF3)
val ZarvisAccentIndigoLight = Color(0xFF7E22CE) // the light primary: royal purple
val ZarvisErrorLight = Color(0xFFB42318)
val ZarvisWarningLight = Color(0xFF92400E)
val ZarvisSuccessLight = Color(0xFF065F46)

// ---- Brand accents (bright: glows, orbs, gradients, icons on a dark page; not text on a light page) ----
val ZarvisAccentIndigo = Color(0xFF9333EA)
val ZarvisAccentCyan = Color(0xFF06B6D4) // the HUD cyan of the orb's tick ring
val ZarvisAccentBlue = Color(0xFF3B82F6)
val ZarvisAccentViolet = Color(0xFF8B5CF6)
val ZarvisAccentPink = Color(0xFFEC4899)

// ---- Queen jewels (decoration: the rays, glitter, rings and the tab bar's edge; never text on the light page) ----
val ZarvisGold = Color(0xFFFBBF24)
val ZarvisGoldPale = Color(0xFFFDE68A)
val ZarvisAmber = Color(0xFFF59E0B)
val ZarvisRose = Color(0xFFFB7185)
val ZarvisOrchid = Color(0xFFF472B6)
val ZarvisAmethyst = Color(0xFFC084FC)
val ZarvisMagenta = Color(0xFFD946EF)

/** Dark plum for text and icons on gold (the dark theme's primary, the middle tab's orb): over 8:1 on every gold. */
val ZarvisInkOnGold = Color(0xFF2A0A36)

// ---- The gradient under white text and icons: royal purple → rose → amber. Every stop is at least 4.5:1 with white ----
val ZarvisActionBlue = Color(0xFF7E22CE) // name kept for existing callers; it is the purple stop now
val ZarvisActionViolet = Color(0xFFBE185D)
val ZarvisActionPink = Color(0xFFB45309)

/** Risk colours for a dark page (see [ZarvisExtras] for the theme-aware ones that [com.zarvismobile.core.ui.components.RiskBadge] uses). */
object RiskColors {
    val low = ZarvisSuccessDark
    val medium = ZarvisWarningDark
    val high = ZarvisErrorDark
}

object GlowColors {
    val active = ZarvisGold
    val success = ZarvisSuccessDark
    val warning = ZarvisWarningDark
    val error = ZarvisErrorDark
}

/**
 * Everything that has to change with the theme and is not part of Material's colour scheme: the glass surfaces, their edges, and
 * text-safe accents. Provided by [ZarvisTheme]; read it through [GlassColors], [ZarvisAccents] or [LocalZarvisExtras].
 *
 * Glass is a translucent tint over the page: a white veil in light, a plum veil with a gold hairline in dark.
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
    val accentGold: Color,
    val success: Color,
    val warning: Color,
    val danger: Color,
)

val LightExtras = ZarvisExtras(
    isDark = false,
    glass = Color.White.copy(alpha = 0.78f),
    glassElevated = Color.White.copy(alpha = 0.94f),
    glassBorder = Color(0x2E7E22CE),
    glassBorderStrong = Color(0x4D7E22CE),
    glassHighlight = Color.White.copy(alpha = 0.9f),
    accentCyan = Color(0xFF155E75), // ink shades: 4.5:1 or more on the page, on a glass card and under the page's glows
    accentViolet = Color(0xFF6D28D9),
    accentPink = Color(0xFF9D174D),
    accentGold = Color(0xFF92400E),
    success = ZarvisSuccessLight,
    warning = ZarvisWarningLight,
    danger = ZarvisErrorLight,
)

val DarkExtras = ZarvisExtras(
    isDark = true,
    glass = Color(0xFF3A1650).copy(alpha = 0.72f),
    glassElevated = Color(0xFF2E1042).copy(alpha = 0.88f),
    glassBorder = ZarvisWarningDark.copy(alpha = 0.22f), // the gold hairline
    glassBorderStrong = ZarvisWarningDark.copy(alpha = 0.40f),
    glassHighlight = Color.White.copy(alpha = 0.06f),
    accentCyan = Color(0xFF67E8F9),
    accentViolet = Color(0xFFE9D5FF),
    accentPink = Color(0xFFF9A8D4),
    accentGold = ZarvisGoldPale,
    success = ZarvisSuccessDark,
    warning = ZarvisWarningDark,
    danger = ZarvisErrorDark,
)

val LocalZarvisExtras = staticCompositionLocalOf { DarkExtras }

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
    val gold: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.accentGold
    val success: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.success
    val warning: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.warning
    val danger: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.danger
}

/**
 * The text-safe version of one of the bright brand accents ([ZarvisAccentCyan], [ZarvisAccentViolet], [ZarvisAccentPink], [ZarvisGold])
 * for the current theme; any other colour is returned as given. Lets a screen that already passes an accent around keep doing so while
 * its words stay readable on the light page (the bright cyan is 2.4:1 there).
 */
@Composable
@ReadOnlyComposable
fun readableAccent(accent: Color): Color = when (accent) {
    ZarvisAccentCyan -> ZarvisAccents.cyan
    ZarvisAccentViolet -> ZarvisAccents.violet
    ZarvisAccentPink -> ZarvisAccents.pink
    ZarvisGold -> ZarvisAccents.gold
    else -> accent
}
