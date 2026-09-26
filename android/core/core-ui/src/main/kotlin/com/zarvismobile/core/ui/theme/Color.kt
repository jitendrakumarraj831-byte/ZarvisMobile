package com.zarvismobile.core.ui.theme

import androidx.compose.ui.graphics.Color

/** ZARVIS Aurora Glass palette — bright surfaces with cyan/blue/violet/pink accents. */
val ZarvisSpaceBlack = Color(0xFF0B1020)
val ZarvisSurfaceDark = Color(0xFF151C32)
val ZarvisSurfaceDarkElevated = Color(0xFF202944)
val ZarvisAccentIndigo = Color(0xFF6366F1)
val ZarvisAccentCyan = Color(0xFF06B6D4)
val ZarvisAccentViolet = Color(0xFF8B5CF6)
val ZarvisAccentPink = Color(0xFFEC4899)
val ZarvisTextPrimaryDark = Color(0xFFF4F7FF)
val ZarvisTextSecondaryDark = Color(0xFFAAB4CE)
val ZarvisBorderDark = Color(0xFF33405C)
val ZarvisErrorDark = Color(0xFFE11D48)
val ZarvisWarningDark = Color(0xFFD97706)
val ZarvisSuccessDark = Color(0xFF059669)

val ZarvisSurfaceLight = Color(0xFFF7FAFF)
val ZarvisSurfaceLightElevated = Color(0xFFFFFFFF)
val ZarvisAccentIndigoLight = Color(0xFF4F46E5)
val ZarvisTextPrimaryLight = Color(0xFF18213A)
val ZarvisTextSecondaryLight = Color(0xFF68738D)
val ZarvisBorderLight = Color(0xFFDCE4F2)
val ZarvisErrorLight = Color(0xFFBE123C)
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
    val surfaceTint = Color.White.copy(alpha = 0.78f)
    val surfaceTintElevated = Color.White.copy(alpha = 0.88f)
    val border = Color(0x26718CBB)
    val borderStrong = Color(0x3D5B72A8)
}
