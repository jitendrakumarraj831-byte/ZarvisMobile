@file:OptIn(ExperimentalTextApi::class)

package com.zarvismobile.core.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.zarvismobile.core.ui.R

/**
 * The Queen type (ANDROID_QUEEN_DESIGN.md): Sora for everything people read, Orbitron for the brand name and the small gold
 * section labels. Both are variable fonts shipped unmodified in res/font (SIL Open Font License 1.1, see THIRD_PARTY_NOTICES.md);
 * each weight below is one instance of the same file. Neither font has Devanagari, so Hindi falls back to the phone's own
 * Devanagari font (Noto on stock Android) letter by letter, as before.
 */
val ZarvisFontFamily = FontFamily(
    Font(R.font.sora, FontWeight.Normal),
    Font(R.font.sora, FontWeight.Medium),
    Font(R.font.sora, FontWeight.SemiBold),
    Font(R.font.sora, FontWeight.Bold),
    Font(R.font.sora, FontWeight.ExtraBold),
)

/** The brand and label face. Use it through [ZarvisDisplayStyles], never for sentences. */
val ZarvisDisplayFontFamily = FontFamily(
    Font(R.font.orbitron, FontWeight.Bold),
    Font(R.font.orbitron, FontWeight.Black),
)

/** The two Orbitron styles: the ZARVIS wordmark and the small uppercase gold label over a section. */
object ZarvisDisplayStyles {
    val brand = TextStyle(fontFamily = ZarvisDisplayFontFamily, fontWeight = FontWeight.Black, fontSize = 20.sp, lineHeight = 24.sp, letterSpacing = 4.sp)
    val kicker = TextStyle(fontFamily = ZarvisDisplayFontFamily, fontWeight = FontWeight.Bold, fontSize = 11.sp, lineHeight = 16.sp, letterSpacing = 2.sp)
}

private val Defaults = Typography()

val ZarvisTypography = Typography(
    displayLarge = TextStyle(fontFamily = ZarvisFontFamily, fontWeight = FontWeight.Bold, fontSize = 40.sp, lineHeight = 48.sp),
    displayMedium = Defaults.displayMedium.copy(fontFamily = ZarvisFontFamily),
    displaySmall = Defaults.displaySmall.copy(fontFamily = ZarvisFontFamily),
    headlineLarge = TextStyle(fontFamily = ZarvisFontFamily, fontWeight = FontWeight.Bold, fontSize = 28.sp, lineHeight = 36.sp),
    headlineMedium = TextStyle(fontFamily = ZarvisFontFamily, fontWeight = FontWeight.Bold, fontSize = 24.sp, lineHeight = 32.sp),
    headlineSmall = Defaults.headlineSmall.copy(fontFamily = ZarvisFontFamily, fontWeight = FontWeight.Bold),
    titleLarge = TextStyle(fontFamily = ZarvisFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 28.sp),
    titleMedium = TextStyle(fontFamily = ZarvisFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 24.sp),
    titleSmall = Defaults.titleSmall.copy(fontFamily = ZarvisFontFamily, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontFamily = ZarvisFontFamily, fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontFamily = ZarvisFontFamily, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 21.sp),
    bodySmall = Defaults.bodySmall.copy(fontFamily = ZarvisFontFamily, lineHeight = 18.sp),
    labelLarge = TextStyle(fontFamily = ZarvisFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontFamily = ZarvisFontFamily, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp),
    labelSmall = Defaults.labelSmall.copy(fontFamily = ZarvisFontFamily),
)
