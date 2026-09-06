package com.zarvismobile.core.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.theme.GlassColors
import com.zarvismobile.core.ui.theme.ZarvisSpacing

/**
 * The design system's single card container — consistent elevation/corner radius everywhere,
 * finished with the same hairline glass border used across the "Zarvis Cyber Luxury" surfaces
 * (MASTER_SPEC.md §22) so cards read as part of the same glassmorphism family as [GlassSurface].
 */
@Composable
fun ZarvisCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = BorderStroke(width = 1.dp, color = GlassColors.border),
    ) {
        Column(
            modifier = Modifier.padding(ZarvisSpacing.md),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
            content = content,
        )
    }
}
