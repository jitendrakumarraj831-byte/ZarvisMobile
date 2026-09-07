package com.zarvismobile.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.Brush
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Work
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zarvismobile.core.ui.components.AiOrb
import com.zarvismobile.core.ui.components.ZarvisCard
import com.zarvismobile.core.ui.components.ZarvisChip
import com.zarvismobile.core.ui.components.ZarvisComposer
import com.zarvismobile.core.ui.components.VoiceState
import com.zarvismobile.core.ui.components.ZarvisBackground
import com.zarvismobile.core.ui.theme.ZarvisSpacing

private data class QuickCategory(val label: String, val icon: ImageVector, val example: String)

/** MASTER_SPEC.md §22 "2-Row Compact Category Chips": Web, Documents, Developer, Business, Creative, Automation, Research. */
private val QUICK_CATEGORIES = listOf(
    QuickCategory("Web", Icons.Filled.Public, "Find the best phone under 20000"),
    QuickCategory("Documents", Icons.Filled.Description, "Summarize this document"),
    QuickCategory("Developer", Icons.Filled.Code, "Check my GitHub project for errors"),
    QuickCategory("Business", Icons.Filled.Work, "What's important for me to do today?"),
    QuickCategory("Creative", Icons.Filled.Brush, "Write a short product description"),
    QuickCategory("Automation", Icons.Filled.Autorenew, "Set a daily reminder for standup"),
    QuickCategory("Research", Icons.Filled.Search, "Research the top 3 competitors"),
)

/** Workspace screen — MASTER_SPEC.md §22 "Workspace Page (/)": voice orb + composer + quick categories. */
@OptIn(ExperimentalLayoutApi::class)
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
    var composerText by remember { mutableStateOf("") }

    ZarvisBackground(modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.fillMaxSize()) {
            LazyColumn(
                modifier = Modifier.fillMaxSize().statusBarsPadding(),
                contentPadding = PaddingValues(ZarvisSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.lg),
            ) {
                item {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        IconButton(onClick = onNavigateToSettings) {
                            Icon(
                                imageVector = Icons.Filled.Settings,
                                contentDescription = "Settings",
                            )
                        }
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                        Text(text = "ZARVIS MOBILE", style = MaterialTheme.typography.headlineMedium)
                        Text(
                            text = "आप क्या करवाना चाहते हैं?",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                    }
                }

                item {
                    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        AiOrb(state = VoiceState.IDLE, size = 140.dp, onClick = { onNavigateToConversation(null) })
                    }
                }

                item {
                    ZarvisComposer(
                        value = composerText,
                        onValueChange = { composerText = it },
                        onSubmit = {
                            if (composerText.isNotBlank()) {
                                onNavigateToConversation(composerText)
                                composerText = ""
                            }
                        },
                        onMicClick = { onNavigateToConversation(null) },
                    )
                }

                item {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
                        verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm),
                        maxItemsInEachRow = 4,
                    ) {
                        QUICK_CATEGORIES.forEach { category ->
                            ZarvisChip(
                                label = category.label,
                                icon = category.icon,
                                onClick = { onNavigateToConversation(category.example) },
                            )
                        }
                    }
                }

                item {
                    ZarvisCard(modifier = Modifier.fillMaxWidth()) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(text = "What can you do?", style = MaterialTheme.typography.titleMedium)
                        }
                        Text(
                            text = "See every skill ZARVIS currently has, grouped by category.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        TextButton(onClick = onNavigateToCapabilities) {
                            Text("Browse skills (${uiState.skills.size})")
                        }
                    }
                }

                item {
                    ZarvisCard(modifier = Modifier.fillMaxWidth()) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(text = "Subscription", style = MaterialTheme.typography.titleMedium)
                        }
                        val entitlement = uiState.entitlement
                        if (entitlement != null) {
                            Text("Plan: ${entitlement.plan} · ${entitlement.creditBalance} credits left")
                        } else if (uiState.isLoading) {
                            CircularProgressIndicator(modifier = Modifier.size(20.dp))
                        }
                        TextButton(onClick = onNavigateToSubscription) {
                            Text("Manage subscription")
                        }
                    }
                }

                item {
                    ZarvisCard(modifier = Modifier.fillMaxWidth()) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(text = "Recent Tasks", style = MaterialTheme.typography.titleMedium)
                            TextButton(onClick = onNavigateToTasks) { Text("See all") }
                        }
                        if (uiState.tasks.isEmpty() && !uiState.isLoading) {
                            Text(
                                text = "No tasks yet — ask ZARVIS to do something to get started.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        uiState.tasks.take(3).forEach { task ->
                            Text(text = "${task.goal} · ${task.status}", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }

                item {
                    TextButton(onClick = onNavigateToDeveloper, modifier = Modifier.fillMaxWidth()) {
                        Text("Open Developer Mode")
                    }
                }

                uiState.error?.let { error ->
                    item {
                        Text(text = error, color = MaterialTheme.colorScheme.error)
                    }
                }

                item { Spacer(modifier = Modifier.size(ZarvisSpacing.xxl)) }
            }
        }
    }
}
