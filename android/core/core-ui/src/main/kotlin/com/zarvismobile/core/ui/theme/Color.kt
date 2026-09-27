package com.zarvismobile.core.ui.theme

import androidx.compose.ui.graphics.Color

/** ZARVIS Aurora Noir — premium AI-agent palette. */
val ZarvisSpaceBlack = Color(0xFF070A12)
val ZarvisSurfaceDark = Color(0xFF101522)
val ZarvisSurfaceDarkElevated = Color(0xFF171E2E)
val ZarvisAccentIndigo = Color(0xFF6366F1)
val ZarvisAccentCyan = Color(0xFF22D3EE)
val ZarvisAccentViolet = Color(0xFF8B5CF6)
val ZarvisAccentPink = Color(0xFFF472B6)
val ZarvisTextPrimaryDark = Color(0xFFF7F9FF)
val ZarvisTextSecondaryDark = Color(0xFFA8B1C7)
val ZarvisBorderDark = Color(0xFF293247)
val ZarvisErrorDark = Color(0xFFFB7185)
val ZarvisWarningDark = Color(0xFFFBBF24)
val ZarvisSuccessDark = Color(0xFF34D399)

val ZarvisSurfaceLight = Color(0xFFF5F7FC)
val ZarvisSurfaceLightElevated = Color(0xFFFFFFFF)
val ZarvisAccentIndigoLight = Color(0xFF4F46E5)
val ZarvisTextPrimaryLight = Color(0xFF111827)
val ZarvisTextSecondaryLight = Color(0xFF667085)
val ZarvisBorderLight = Color(0xFFD9E0EC)
val ZarvisErrorLight = Color(0xFFE11D48)
val ZarvisWarningLight = Color(0xFFB45309)
val ZarvisSuccessLight = Color(0xFF047857)

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

object GlassColors {
    val surfaceTint = Color.White.copy(alpha = 0.68f)
    val surfaceTintElevated = Color.White.copy(alpha = 0.84f)
    val border = Color(0x33718CBB)
    val borderStrong = Color(0x4D5B72A8)
}
