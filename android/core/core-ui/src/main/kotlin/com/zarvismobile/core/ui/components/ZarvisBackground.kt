package com.zarvismobile.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import com.zarvismobile.core.ui.theme.LocalZarvisExtras

/**
 * The aurora page: three soft colour washes (blue top-left, violet top-right, pink bottom) over the theme's page colour, the same
 * values and corners as the website's canvas (`--aurora-1..3`). It is painted once per size or theme change, never animated, and
 * costs three gradient fills, which is why it is safe on a low-end phone. Deliberately restrained so content stays primary.
 */
@Composable
fun ZarvisBackground(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val base = MaterialTheme.colorScheme.background
    val dark = LocalZarvisExtras.current.isDark
    // web/styles.css --aurora-1..3, light and dim
    val wash1 = if (dark) Color(0x332878FF) else Color(0x3378BEFF)
    val wash2 = if (dark) Color(0x2B8246FF) else Color(0x299678FF)
    val wash3 = if (dark) Color(0x1AEC48BE) else Color(0x1FFF96D2)
    Box(
        modifier = modifier.fillMaxSize().background(base).drawBehind {
            val reach = size.maxDimension
            drawRect(Brush.radialGradient(listOf(wash1, Color.Transparent), Offset(0f, 0f), reach * .62f))
            drawRect(Brush.radialGradient(listOf(wash2, Color.Transparent), Offset(size.width, size.height * .18f), reach * .6f))
            drawRect(Brush.radialGradient(listOf(wash3, Color.Transparent), Offset(size.width * .4f, size.height * 1.05f), reach * .62f))
        },
        content = content,
    )
}
