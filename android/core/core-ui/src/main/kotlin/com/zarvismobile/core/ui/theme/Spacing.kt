package com.zarvismobile.core.ui.theme

import androidx.compose.ui.unit.dp

/**
 * 8dp spacing scale — see MASTER_SPEC.md §22 — with a 12dp step for the gap between items, and the sizes every page shares, so a
 * screen spaces itself with names instead of loose numbers.
 */
object ZarvisSpacing {
    val xxs = 2.dp
    val xs = 4.dp
    val sm = 8.dp

    /** The gap between items in a list, the lines of a card, and an icon and its label. */
    val gap = 12.dp
    val md = 16.dp
    val lg = 24.dp
    val xl = 32.dp
    val xxl = 48.dp

    /** The left and right margin of every page. */
    val pageGutter = 16.dp

    /** The space between a page's sections. */
    val section = 20.dp

    /** The smallest thing a finger is asked to hit (Material and WCAG 2.5.8): every button, chip and row is at least this tall. */
    val touchTarget = 48.dp

    /** A list row with an icon tile, a title and one line of detail. */
    val rowMinHeight = 64.dp
}
