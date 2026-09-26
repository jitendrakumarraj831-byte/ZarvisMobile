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
import com.zarvismobile.core.ui.theme.ZarvisAccentPink
import com.zarvismobile.core.ui.theme.ZarvisAccentViolet
import com.zarvismobile.core.ui.theme.ZarvisSurfaceLight

/** Bright aurora-glass backdrop shared by the app's top-level screens. */
@Composable
fun ZarvisBackground(
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(ZarvisSurfaceLight)
            .drawBehind {
                drawRect(
                    brush = Brush.radialGradient(
                        colors = listOf(ZarvisAccentPink.copy(alpha = 0.18f), Color.Transparent),
                        center = Offset(size.width * 0.05f, size.height * 0.04f),
                        radius = size.maxDimension * 0.62f,
                    ),
                )
                drawRect(
                    brush = Brush.radialGradient(
                        colors = listOf(ZarvisAccentCyan.copy(alpha = 0.15f), Color.Transparent),
                        center = Offset(size.width * 0.96f, size.height * 0.08f),
                        radius = size.maxDimension * 0.55f,
                    ),
                )
                drawRect(
                    brush = Brush.radialGradient(
                        colors = listOf(ZarvisAccentViolet.copy(alpha = 0.12f), Color.Transparent),
                        center = Offset(size.width * 0.62f, size.height * 0.98f),
                        radius = size.maxDimension * 0.52f,
                    ),
                )
                drawRect(
                    brush = Brush.linearGradient(
                        colors = listOf(
                            ZarvisAccentCyan.copy(alpha = 0.035f),
                            ZarvisAccentIndigo.copy(alpha = 0.035f),
                            ZarvisAccentPink.copy(alpha = 0.035f),
                        ),
                    ),
                )
            },
        content = content,
    )
}
