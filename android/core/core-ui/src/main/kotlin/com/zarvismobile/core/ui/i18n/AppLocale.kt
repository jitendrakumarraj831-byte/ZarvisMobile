package com.zarvismobile.core.ui.i18n

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import com.zarvismobile.domain.presentation.UiString

/**
 * The language the app's own labels are drawn in: `"en"` or `"hi"`. The root sets it from the saved Language setting, so
 * choosing Hindi redraws every screen that uses [tr] on the spot. Screens that still hold plain English text are not
 * affected, which is why the Language page says what Hindi covers today.
 */
val LocalAppLocale = staticCompositionLocalOf { "en" }

/** [text] in the app's language. */
@Composable
fun tr(text: UiString): String = text.text(LocalAppLocale.current)

/** [text] in the app's language with its `%s` / `%d` filled in by [args]. */
@Composable
fun trf(text: UiString, vararg args: Any): String = text.format(LocalAppLocale.current, *args)
