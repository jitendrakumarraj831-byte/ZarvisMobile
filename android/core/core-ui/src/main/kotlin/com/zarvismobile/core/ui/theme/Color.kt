package com.zarvismobile.core.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * ZARVIS MOBILE design tokens — dark-first per MASTER_SPEC.md §22 ("futuristic, premium,
 * minimal, trustworthy"). The accent is used for the AI Orb, primary actions, and voice
 * states; it must never be the only signal for an error/warning state (accessibility).
 */

// Dark theme (default)
val ZarvisSpaceBlack = Color(0xFF0B0D14)
val ZarvisSurfaceDark = Color(0xFF14171F)
val ZarvisSurfaceDarkElevated = Color(0xFF1C202B)
val ZarvisAccentIndigo = Color(0xFF6C6BFF)
val ZarvisAccentCyan = Color(0xFF4EE1D6)
val ZarvisTextPrimaryDark = Color(0xFFF3F4F8)
val ZarvisTextSecondaryDark = Color(0xFFA0A5B8)
val ZarvisBorderDark = Color(0xFF2A2F3D)
val ZarvisErrorDark = Color(0xFFFF6B6B)
val ZarvisWarningDark = Color(0xFFFFC46B)
val ZarvisSuccessDark = Color(0xFF5FE38B)

// Light theme
val ZarvisSurfaceLight = Color(0xFFFFFFFF)
val ZarvisSurfaceLightElevated = Color(0xFFF4F5F9)
val ZarvisAccentIndigoLight = Color(0xFF4B4AE0)
val ZarvisTextPrimaryLight = Color(0xFF14171F)
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
