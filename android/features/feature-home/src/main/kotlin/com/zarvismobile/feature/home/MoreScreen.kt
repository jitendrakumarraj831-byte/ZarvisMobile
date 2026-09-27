package com.zarvismobile.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.components.ZarvisCard
import com.zarvismobile.core.ui.theme.ZarvisSpacing

private data class MoreDestination(val title: String, val body: String, val id: String)

private val DESTINATIONS = listOf(
    MoreDestination("Phone Agent", "Open apps, find contacts, and place confirmed calls on this phone.", "phone"),
    MoreDestination("Files", "Attach a file from Chat. This phone build does not include a separate file browser.", "documents"),
    MoreDestination("Research", "Search and structured questions run in Chat.", "research"),
    MoreDestination("Creative", "Writing skills are live. Image generation is not.", "creative"),
    MoreDestination("Business", "Draft a post, reply, or invoice. Nothing is sent.", "business"),
    MoreDestination("Developer", "Analyze a repository. Implementation stays on the confirmed server path.", "developer"),
    MoreDestination("Plans", "Current plan and credits. Checkout is not connected.", "plans"),
    MoreDestination("Settings", "Language, appearance, voice, and account.", "settings"),
)

@Composable
fun MoreScreen(
    onOpenFeature: (String) -> Unit,
    onOpenDeveloper: () -> Unit,
    onOpenPlans: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(ZarvisSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
        ) {
            item {
                Text("Work", style = MaterialTheme.typography.headlineMedium)
                Text(
                    "The same product areas as the website. Each item opens the real screen.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            items(DESTINATIONS) { destination ->
                ZarvisCard(modifier = Modifier.fillMaxWidth()) {
                    Text(destination.title, style = MaterialTheme.typography.titleMedium)
                    Text(destination.body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = {
                        when (destination.id) {
                            "developer" -> onOpenDeveloper()
                            "plans" -> onOpenPlans()
                            "settings" -> onOpenSettings()
                            else -> onOpenFeature(destination.id)
                        }
                    }) { Text("Open") }
                }
            }
        }
    }
}
