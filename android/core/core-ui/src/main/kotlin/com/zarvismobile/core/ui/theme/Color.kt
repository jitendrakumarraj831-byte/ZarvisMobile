package com.zarvismobile.core.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * "Zarvis Cyber Luxury" design tokens — dark-first, deep-midnight base with electric-cyan
 * signal accents (MASTER_SPEC.md §22: "futuristic, premium, minimal, trustworthy"). The
 * accent drives the AI Orb, primary actions, and active voice/nav states; per accessibility
 * guidance it must never be the only signal for an error/warning state.
 */

// Dark theme (default) — Deep Midnight base
val ZarvisSpaceBlack = Color(0xFF030712)
val ZarvisSurfaceDark = Color(0xFF0B1120)
val ZarvisSurfaceDarkElevated = Color(0xFF111827)
val ZarvisAccentIndigo = Color(0xFF6C6BFF)
val ZarvisAccentCyan = Color(0xFF00F0FF)
val ZarvisTextPrimaryDark = Color(0xFFF3F6FA)
val ZarvisTextSecondaryDark = Color(0xFF8B93A7)
val ZarvisBorderDark = Color(0xFF232B3D)
val ZarvisErrorDark = Color(0xFFFF3B5C)
val ZarvisWarningDark = Color(0xFFFFB020)
val ZarvisSuccessDark = Color(0xFF10E38F)

// Light theme
val ZarvisSurfaceLight = Color(0xFFFFFFFF)
val ZarvisSurfaceLightElevated = Color(0xFFF4F5F9)
val ZarvisAccentIndigoLight = Color(0xFF4B4AE0)
val ZarvisTextPrimaryLight = Color(0xFF0B1120)
val ZarvisTextSecondaryLight = Color(0xFF5B6072)
val ZarvisBorderLight = Color(0xFFE1E3EB)
val ZarvisErrorLight = Color(0xFFD8433D)
val ZarvisWarningLight = Color(0xFFB5760A)
val ZarvisSuccessLight = Color(0xFF1E9E56)

/** Risk-level colors — used consistently wherever a LOW/MEDIUM/HIGH badge is shown (MASTER_SPEC.md §21). */
object RiskColors {
    val low = ZarvisSuccessDark
    val medium = ZarvisWarningDark
    val high = ZarvisErrorDark
}

/**
 * Status "glow" colors for the dynamic state lighting used by the AI Orb, bottom nav, and
 * optimistic execution widgets: Active = electric cyan pulse, Success = emerald glow,
 * Warning/Error stay the shared risk colors so a single palette is used everywhere.
 */
object GlowColors {
    val active = ZarvisAccentCyan
    val success = ZarvisSuccessDark
    val warning = ZarvisWarningDark
    val error = ZarvisErrorDark
}

/** Glassmorphism surface tokens — translates `bg-white/[0.03] border-white/10` to Compose alpha overlays. */
object GlassColors {
    val surfaceTint = Color.White.copy(alpha = 0.03f)
    val surfaceTintElevated = Color.White.copy(alpha = 0.06f)
    val border = Color.White.copy(alpha = 0.10f)
    val borderStrong = Color.White.copy(alpha = 0.18f)
}
