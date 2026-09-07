package com.zarvismobile.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import com.zarvismobile.core.ui.theme.ZarvisAccentCyan
import com.zarvismobile.core.ui.theme.ZarvisAccentIndigo
import com.zarvismobile.core.ui.theme.ZarvisSpaceBlack

/**
 * The deep-midnight backdrop shared by every top-level screen — a solid `#030712` base with
 * two soft, out-of-focus radial glows (MASTER_SPEC.md §22 "subtle radial mesh background
 * gradients"). Cheap: two `drawRect` calls on the existing draw pass, no offscreen buffers.
 */
@Composable
fun ZarvisBackground(
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(ZarvisSpaceBlack)
            .drawBehind {
                drawRect(
                    brush = Brush.radialGradient(
                        colors = listOf(ZarvisAccentCyan.copy(alpha = 0.10f), Color.Transparent),
                        center = Offset(size.width * 0.18f, size.height * 0.06f),
                        radius = size.maxDimension * 0.55f,
                    ),
                )
                drawRect(
                    brush = Brush.radialGradient(
                        colors = listOf(ZarvisAccentIndigo.copy(alpha = 0.14f), Color.Transparent),
                        center = Offset(size.width * 0.9f, size.height * 0.35f),
                        radius = size.maxDimension * 0.5f,
                    ),
                )
            },
        content = content,
    )
}
