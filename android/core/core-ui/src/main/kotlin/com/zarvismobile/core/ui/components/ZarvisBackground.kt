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
import androidx.compose.ui.graphics.luminance
import com.zarvismobile.core.ui.theme.ZarvisAccentCyan
import com.zarvismobile.core.ui.theme.ZarvisAccentIndigo
import com.zarvismobile.core.ui.theme.ZarvisAccentViolet

/** Subtle premium aurora backdrop; deliberately restrained so content stays primary. */
@Composable
fun ZarvisBackground(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val base = androidx.compose.material3.MaterialTheme.colorScheme.background
    Box(
        modifier = modifier.fillMaxSize().background(base).drawBehind {
            val a = if (base.luminance() > 0.5f) 0.10f else 0.08f
            drawRect(Brush.radialGradient(listOf(ZarvisAccentCyan.copy(alpha = a), Color.Transparent), Offset(size.width * .08f, size.height * .02f), size.maxDimension * .48f))
            drawRect(Brush.radialGradient(listOf(ZarvisAccentViolet.copy(alpha = a), Color.Transparent), Offset(size.width * .92f, size.height * .18f), size.maxDimension * .52f))
            drawRect(Brush.radialGradient(listOf(ZarvisAccentIndigo.copy(alpha = a * .8f), Color.Transparent), Offset(size.width * .55f, size.height * .98f), size.maxDimension * .55f))
        },
        content = content,
    )
}
