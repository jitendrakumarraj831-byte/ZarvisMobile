package com.zarvismobile.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.AiOrb
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.VoiceState
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.theme.ZarvisSpacing

private data class Shortcut(val title: String, val description: String, val icon: ImageVector, val prompt: String)

private val SHORTCUTS = listOf(
    Shortcut("Chat", "Ask anything", Icons.Filled.Forum, ""),
    Shortcut("Voice assistant", "Talk naturally", Icons.Filled.VolumeUp, ""),
    Shortcut("Research", "Find and compare", Icons.Filled.Search, "Research this for me"),
    Shortcut("Developer agent", "Plan and build", Icons.Filled.Code, "Analyze my repository"),
    Shortcut("Files & documents", "Read and analyze", Icons.Filled.Description, "Analyze this document"),
    Shortcut("Memory", "Your context", Icons.Filled.Psychology, "Show my saved context"),
)

/** Dashboard surface. Conversation remains a dedicated destination reached by the primary CTA. */
@Composable
fun HomeScreen(
    onNavigateToConversation: (initialText: String?) -> Unit,
    onNavigateToTasks: () -> Unit,
    onNavigateToSubscription: () -> Unit,
    onNavigateToDeveloper: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToCapabilities: () -> Unit = {},
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().statusBarsPadding(),
            contentPadding = PaddingValues(ZarvisSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.lg),
        ) {
            item {
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Good to see you", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("ZARVIS", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    }
                    StatusPill()
                    IconButton(onClick = onNavigateToSettings) { Icon(Icons.Filled.Settings, "Settings") }
                }
            }
            item {
                GlassSurface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(28.dp),
                    tint = MaterialTheme.colorScheme.primary.copy(alpha = .10f),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md)) {
                        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { AiOrb(VoiceState.IDLE, size = 104.dp, onClick = { onNavigateToConversation(null) }) }
                        Text("Your AI assistant, ready when you are.", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                        Text("Chat, create, research, code, analyze and automate with ZARVIS.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Button(onClick = { onNavigateToConversation(null) }, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Filled.Forum, null)
                            Spacer(Modifier.size(8.dp))
                            Text("Chat with ZARVIS")
                        }
                    }
                }
            }
            item { Text("Quick actions", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }
            items(SHORTCUTS.chunked(2)) { row ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.md)) {
                    row.forEach { shortcut ->
                        GlassSurface(modifier = Modifier.weight(1f).clickable { onNavigateToConversation(shortcut.prompt.takeIf { it.isNotBlank() }) }) {
                            Box(modifier = Modifier.size(38.dp).background(MaterialTheme.colorScheme.primary.copy(alpha = .12f), CircleShape), contentAlignment = Alignment.Center) { Icon(shortcut.icon, null, tint = MaterialTheme.colorScheme.primary) }
                            Spacer(Modifier.size(ZarvisSpacing.sm))
                            Text(shortcut.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                            Text(shortcut.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
            item {
                Text("Assistant status", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                GlassSurface(modifier = Modifier.fillMaxWidth()) {
                    Column(verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
                        StatusLine("AI ready", "Provider connected", true)
                        StatusLine("Voice ready", "Native voice + browser fallback", true)
                        StatusLine("Backend connected", "Session active", true)
                    }
                }
            }
            item {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("Recent activity", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    IconButton(onClick = onNavigateToTasks) { Icon(Icons.Filled.History, "Open activity") }
                }
                GlassSurface(modifier = Modifier.fillMaxWidth().clickable { onNavigateToTasks() }) {
                    Text(if (uiState.tasks.isEmpty()) "No recent tasks yet" else uiState.tasks.first().goal, style = MaterialTheme.typography.bodyLarge)
                    Text(if (uiState.tasks.isEmpty()) "Start a conversation to see activity here." else "Task activity", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            item { Spacer(Modifier.size(ZarvisSpacing.xxl)) }
        }
    }
}

@Composable private fun StatusPill() {
    Badge(containerColor = MaterialTheme.colorScheme.tertiary) { Text("Online", modifier = Modifier.padding(horizontal = 8.dp), color = MaterialTheme.colorScheme.onTertiary) }
}

@Composable private fun StatusLine(title: String, detail: String, ready: Boolean) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(9.dp).background(if (ready) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.error, CircleShape))
        Column(Modifier.padding(start = 10.dp).weight(1f)) { Text(title, fontWeight = FontWeight.SemiBold); Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        Icon(Icons.Filled.Tune, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

