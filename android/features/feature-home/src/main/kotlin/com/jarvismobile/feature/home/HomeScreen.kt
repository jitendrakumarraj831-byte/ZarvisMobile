package com.jarvismobile.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.jarvismobile.core.ui.components.AiOrb
import com.jarvismobile.core.ui.components.JarvisCard
import com.jarvismobile.core.ui.components.JarvisComposer
import com.jarvismobile.core.ui.components.RiskBadge
import com.jarvismobile.core.ui.components.RiskBadgeLevel
import com.jarvismobile.core.ui.components.VoiceState
import com.jarvismobile.core.ui.theme.JarvisSpacing
import com.jarvismobile.data.remote.dto.SkillDto

private val QUICK_CATEGORIES = listOf(
    "Phone" to "phone.open_app",
    "Web" to "web.search",
    "Work" to "docs.summarize",
    "Documents" to "docs.summarize",
    "Developer" to "developer.analyze_repo",
)

/** Home screen — see MASTER_SPEC.md §22 "Home Screen (concept)". */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onNavigateToConversation: (initialText: String?) -> Unit,
    onNavigateToTasks: () -> Unit,
    onNavigateToSubscription: () -> Unit,
    onNavigateToDeveloper: () -> Unit,
    onNavigateToSettings: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    var composerText by remember { mutableStateOf("") }
    var showCapabilities by remember { mutableStateOf(false) }

    Box(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(JarvisSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(JarvisSpacing.lg),
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
                    Text(text = "JARVIS MOBILE", style = MaterialTheme.typography.headlineMedium)
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
                    AiOrb(state = VoiceState.IDLE, onClick = { onNavigateToConversation(null) })
                }
            }

            item {
                JarvisComposer(
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
                Row(horizontalArrangement = Arrangement.spacedBy(JarvisSpacing.sm)) {
                    QUICK_CATEGORIES.forEach { (label, _) ->
                        SuggestionChip(onClick = { onNavigateToConversation(exampleFor(label)) }, label = { Text(label) })
                    }
                }
            }

            item {
                JarvisCard(modifier = Modifier.fillMaxWidth()) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(text = "What can you do?", style = MaterialTheme.typography.titleMedium)
                    }
                    Text(
                        text = "See every skill JARVIS currently has, grouped by category.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    TextButton(onClick = { showCapabilities = true }) {
                        Text("Browse skills (${uiState.skills.size})")
                    }
                }
            }

            item {
                JarvisCard(modifier = Modifier.fillMaxWidth()) {
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
                JarvisCard(modifier = Modifier.fillMaxWidth()) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(text = "Recent Tasks", style = MaterialTheme.typography.titleMedium)
                        TextButton(onClick = onNavigateToTasks) { Text("See all") }
                    }
                    if (uiState.tasks.isEmpty() && !uiState.isLoading) {
                        Text(
                            text = "No tasks yet — ask JARVIS to do something to get started.",
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
                OutlinedButton(onClick = onNavigateToDeveloper, modifier = Modifier.fillMaxWidth()) {
                    Text("Open Developer Mode")
                }
            }

            uiState.error?.let { error ->
                item {
                    Text(text = error, color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }

    if (showCapabilities) {
        val sheetState = rememberModalBottomSheetState()
        ModalBottomSheet(onDismissRequest = { showCapabilities = false }, sheetState = sheetState) {
            CapabilitiesList(skills = uiState.skills)
        }
    }
}

@Composable
private fun CapabilitiesList(skills: List<SkillDto>) {
    val grouped = skills.groupBy { it.category }
    LazyColumn(
        modifier = Modifier.fillMaxWidth().padding(JarvisSpacing.md),
        verticalArrangement = Arrangement.spacedBy(JarvisSpacing.md),
    ) {
        grouped.forEach { (category, categorySkills) ->
            item {
                Text(text = category, style = MaterialTheme.typography.titleMedium)
            }
            items(categorySkills) { skill ->
                Column(modifier = Modifier.padding(bottom = JarvisSpacing.sm)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(JarvisSpacing.sm)) {
                        Text(text = skill.name, style = MaterialTheme.typography.bodyLarge)
                        RiskBadge(level = RiskBadgeLevel.valueOf(skill.riskLevel))
                    }
                    Text(
                        text = skill.description,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

private fun exampleFor(category: String): String = when (category) {
    "Phone" -> "Open YouTube"
    "Web" -> "Find the best phone under 20000"
    "Work" -> "What's important for me to do today?"
    "Documents" -> "Summarize this document"
    "Developer" -> "Check my GitHub project for errors"
    else -> category
}

