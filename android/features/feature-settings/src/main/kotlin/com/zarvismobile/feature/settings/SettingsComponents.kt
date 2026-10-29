package com.zarvismobile.feature.settings

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import com.zarvismobile.core.ui.components.QueenInfoCard
import com.zarvismobile.core.ui.components.QueenSwitchRow
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.readableAccent

// Small building blocks shared by the Settings pages and the Memory screen, on top of core-ui's shared rows and cards.

/**
 * A setting with a switch. The whole row is the switch (one 64dp target that TalkBack reads as "title, on/off, switch"), not just the
 * small thumb at its end.
 */
@Composable
internal fun SettingSwitchRow(title: String, subtitle: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    QueenSwitchRow(title = title, detail = subtitle, checked = checked, onCheckedChange = onCheckedChange)
}

/**
 * A card that only explains: [icon] on a tile in [accent] (one of the bright brand accents is swapped for its text-safe shade on the
 * light page), a bold title, and the explanation under it.
 */
@Composable
internal fun ReadOnlyCard(title: String, body: String, accent: Color, icon: ImageVector = ZarvisIcons.Shield) {
    QueenInfoCard(title = title, body = body, icon = icon, tint = readableAccent(accent))
}
