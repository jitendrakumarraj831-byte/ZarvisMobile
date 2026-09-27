package com.zarvismobile.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import com.zarvismobile.core.ui.components.ZarvisCard
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.theme.ZarvisSpacing

@Composable
fun FeatureDetailScreen(
    featureId: String,
    onBack: () -> Unit,
    onStartChat: (prompt: String, listen: Boolean) -> Unit,
    onOpenDeveloper: () -> Unit,
) {
    val feature = FeatureCatalog.find(featureId)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(ZarvisSpacing.md),
        verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("Back") }
        }
        if (feature == null) {
            Text("That capability is not available.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@Column
        }
        Text(feature.category, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        Text(feature.title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(feature.summary, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(feature.availability, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)

        Block("What it does", feature.what)
        Block("Why it is useful", feature.why)
        Text("How it works", style = MaterialTheme.typography.titleMedium)
        feature.how.forEachIndexed { index, step ->
            Text("${index + 1}. $step", style = MaterialTheme.typography.bodyMedium)
        }
        if (feature.canDo.isNotEmpty()) {
            Text("What it can do", style = MaterialTheme.typography.titleMedium)
            feature.canDo.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) }
        }
        feature.phoneActions.forEach { action ->
            ZarvisCard(modifier = Modifier.fillMaxWidth()) {
                Text(action.title, style = MaterialTheme.typography.titleMedium)
                Text(action.availability, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Text(action.description, style = MaterialTheme.typography.bodyMedium)
                Text("Example: ${action.example}", style = MaterialTheme.typography.bodySmall)
                Text(action.permission, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Block("How to start", feature.start)
        Block("Permissions", feature.permissions)
        Text("Limitations", style = MaterialTheme.typography.titleMedium)
        feature.limits.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) }
        Text("Example prompts", style = MaterialTheme.typography.titleMedium)
        feature.examples.forEach { example ->
            TextButton(onClick = { onStartChat(example, false) }) { Text(example) }
        }
        ZarvisPrimaryButton(
            text = feature.cta,
            onClick = {
                when (feature.action) {
                    "developer" -> onOpenDeveloper()
                    "voice" -> onStartChat("", true)
                    else -> onStartChat(feature.prompt, false)
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun Block(title: String, body: String) {
    Text(title, style = MaterialTheme.typography.titleMedium)
    Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
