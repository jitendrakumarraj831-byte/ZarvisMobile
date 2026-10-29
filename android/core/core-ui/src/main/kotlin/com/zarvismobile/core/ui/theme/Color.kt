package com.zarvismobile.core.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * ZARVIS palette: "Queen Night" (the default) is a navy-black night lit violet and blue, with the ZARVIS gold kept for the brand
 * (the wordmark, the plan and its credits); "Queen Light" is the lavender day version of the same theme.
 *
 * Queen Night is the default appearance; Queen Light is the same theme for daylight. The design (every Android screen, the motion
 * and the speed rules) is in ANDROID_QUEEN_DESIGN.md. The website still uses the Aurora Glass palette (DESIGN_SYSTEM.md) until it
 * moves to Queen in its own change.
 *
 * Two jobs, two colours: the theme's primary (periwinkle on the night page, royal purple on the day page) marks what you can act on
 * and where you are (the selected tab, focus, section labels, small actions), and gold marks ZARVIS itself.
 *
 * The constants below are the raw palette. Screens should not hard-code them for text: a colour that reads well on the dark page
 * is unreadable on the light one (the bright cyan below is 2.4:1 on a white card). Text accents and glass surfaces come from
 * [ZarvisExtras] through [LocalZarvisExtras] / [GlassColors] / [ZarvisAccents], which follow the theme.
 */

// ---- Dark ("Queen Night", the default) -----------------------------------------------------------
val ZarvisSpaceBlack = Color(0xFF070A18) // navy-black night page
val ZarvisSurfaceDark = Color(0xFF0F1329)
val ZarvisSurfaceDarkElevated = Color(0xFF161B38)
val ZarvisSurfaceDarkHighest = Color(0xFF1F2548)
val ZarvisTextPrimaryDark = Color(0xFFF4F6FF)
val ZarvisTextSecondaryDark = Color(0xFFC5CBEA)
val ZarvisBorderDark = Color(0xFF2A3160)
val ZarvisPrimaryDark = Color(0xFFA5B4FC) // periwinkle: the selected tab, focus, links, section labels
val ZarvisErrorDark = Color(0xFFFDA4AF)
val ZarvisWarningDark = Color(0xFFFCD34D)
val ZarvisSuccessDark = Color(0xFF86EFAC)

/** Deep navy for text and icons on the night primary (a selected filter, a filled pill): over 9:1 on periwinkle. */
val ZarvisInkOnPrimaryDark = Color(0xFF0A0F2E)

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

// ---- Night lights (decoration: the page's glows, the orb, the tab indicator; never text on the light page) ----
val ZarvisNightIndigo = Color(0xFF6366F1)
val ZarvisNightLavender = Color(0xFFC4B5FD)
val ZarvisNightSky = Color(0xFF60A5FA)
val ZarvisNightIce = Color(0xFFE0E7FF)

// ---- Queen jewels (gold is the brand; the others decorate the welcome pages and the crown; never text on the light page) ----
val ZarvisGold = Color(0xFFFBBF24)
val ZarvisGoldPale = Color(0xFFFDE68A)
val ZarvisAmber = Color(0xFFF59E0B)
val ZarvisRose = Color(0xFFFB7185)
val ZarvisOrchid = Color(0xFFF472B6)
val ZarvisAmethyst = Color(0xFFC084FC)
val ZarvisMagenta = Color(0xFFD946EF)

/** Dark plum for text and icons on gold (the plan chip, a gold-filled pill): over 8:1 on every gold. */
val ZarvisInkOnGold = Color(0xFF2A0A36)

// ---- The gradient under white text and icons: violet → indigo → blue. Every stop is at least 4.5:1 with white ----
val ZarvisActionStart = Color(0xFF7C3AED)
val ZarvisActionMid = Color(0xFF4F46E5)
val ZarvisActionEnd = Color(0xFF2563EB)

/** Risk colours for a dark page (see [ZarvisExtras] for the theme-aware ones that [com.zarvismobile.core.ui.components.RiskBadge] uses). */
object RiskColors {
    val low = ZarvisSuccessDark
    val medium = ZarvisWarningDark
    val high = ZarvisErrorDark
}

object GlowColors {
    val active = ZarvisNightSky
    val success = ZarvisSuccessDark
    val warning = ZarvisWarningDark
    val error = ZarvisErrorDark
}

/**
 * Everything that has to change with the theme and is not part of Material's colour scheme: the glass surfaces, their edges, and
 * text-safe accents. Provided by [ZarvisTheme]; read it through [GlassColors], [ZarvisAccents] or [LocalZarvisExtras].
 *
 * Queen Pro (ANDROID_QUEEN_DESIGN.md): a card is a solid surface with a hairline edge (white with a purple hairline in light, navy
 * with a periwinkle hairline in dark) and a faint top-lit sheen ([glassHighlight]), so what scrolls behind it never changes how its
 * text reads. The `glass` names are kept from the translucent look they replaced.
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
    val accentBlue: Color,
    val accentViolet: Color,
    val accentPink: Color,
    val accentGold: Color,
    val accentPrimary: Color,
    val success: Color,
    val warning: Color,
    val danger: Color,
)

val LightExtras = ZarvisExtras(
    isDark = false,
    glass = ZarvisSurfaceLightElevated,
    glassElevated = ZarvisSurfaceLightElevated,
    glassBorder = Color(0x2E7E22CE),
    glassBorderStrong = Color(0x4D7E22CE),
    glassHighlight = Color.Transparent, // the day page's cards are white already: no sheen
    accentCyan = Color(0xFF155E75), // ink shades: 4.5:1 or more on the page, on a glass card and under the page's glows
    accentBlue = Color(0xFF1D4ED8),
    accentViolet = Color(0xFF6D28D9),
    accentPink = Color(0xFF9D174D),
    accentGold = Color(0xFF92400E),
    accentPrimary = ZarvisAccentIndigoLight,
    success = ZarvisSuccessLight,
    warning = ZarvisWarningLight,
    danger = ZarvisErrorLight,
)

val DarkExtras = ZarvisExtras(
    isDark = true,
    glass = ZarvisSurfaceDark,
    glassElevated = ZarvisSurfaceDarkElevated,
    glassBorder = ZarvisPrimaryDark.copy(alpha = 0.16f), // the periwinkle hairline
    glassBorderStrong = ZarvisPrimaryDark.copy(alpha = 0.32f),
    glassHighlight = Color.White.copy(alpha = 0.05f),
    accentCyan = Color(0xFF67E8F9),
    accentBlue = Color(0xFF93C5FD),
    accentViolet = Color(0xFFDDD6FE),
    accentPink = Color(0xFFF9A8D4),
    accentGold = ZarvisGoldPale,
    accentPrimary = ZarvisPrimaryDark,
    success = ZarvisSuccessDark,
    warning = ZarvisWarningDark,
    danger = ZarvisErrorDark,
)

val LocalZarvisExtras = staticCompositionLocalOf { DarkExtras }

/** Card surface colours for the current theme (they were constants; the same names now follow light and dark). */
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
    val blue: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.accentBlue
    val violet: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.accentViolet
    val pink: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.accentPink
    val gold: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.accentGold

    /** The theme's primary as an accent: section labels, small actions, a chip's edge and icon (periwinkle at night, royal purple by day). */
    val primary: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.accentPrimary
    val success: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.success
    val warning: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.warning
    val danger: Color @Composable @ReadOnlyComposable get() = LocalZarvisExtras.current.danger
}

/**
 * The text-safe version of one of the bright brand accents ([ZarvisAccentCyan], [ZarvisAccentBlue], [ZarvisAccentViolet], [ZarvisAccentPink], [ZarvisGold])
 * for the current theme; any other colour is returned as given. Lets a screen that already passes an accent around keep doing so while
 * its words stay readable on the light page (the bright cyan is 2.4:1 there).
 */
@Composable
@ReadOnlyComposable
fun readableAccent(accent: Color): Color = when (accent) {
    ZarvisAccentCyan -> ZarvisAccents.cyan
    ZarvisAccentBlue -> ZarvisAccents.blue
    ZarvisAccentViolet -> ZarvisAccents.violet
    ZarvisAccentPink -> ZarvisAccents.pink
    ZarvisGold -> ZarvisAccents.gold
    else -> accent
}
