package com.jarvismobile.feature.subscription

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import com.jarvismobile.core.ui.components.JarvisCard
import com.jarvismobile.core.ui.components.JarvisGhostButton
import com.jarvismobile.core.ui.components.JarvisSecondaryButton
import com.jarvismobile.core.ui.theme.JarvisSpacing
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

private data class PlanInfo(val name: String, val tagline: String)

private val PLANS = listOf(
    PlanInfo("FREE", "LOW-risk, low-cost skills only"),
    PlanInfo("TRIAL", "A taste of everything, time- and credit-boxed"),
    PlanInfo("PRO", "Full access across all shipped skills"),
)

/** MASTER_SPEC.md §19 (Subscription Model). */
@Composable
fun SubscriptionScreen(viewModel: SubscriptionViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()

    Column(
        modifier = Modifier.fillMaxSize().padding(JarvisSpacing.md),
        verticalArrangement = Arrangement.spacedBy(JarvisSpacing.md),
    ) {
        Text(text = "Subscription", style = MaterialTheme.typography.headlineMedium)

        if (uiState.isLoading) CircularProgressIndicator()
        uiState.error?.let { error ->
            Column(verticalArrangement = Arrangement.spacedBy(JarvisSpacing.xs)) {
                Text(text = error, color = MaterialTheme.colorScheme.error)
                JarvisGhostButton(text = "Retry", onClick = viewModel::refresh)
            }
        }

        uiState.entitlement?.let { entitlement ->
            JarvisCard(modifier = Modifier.fillMaxWidth()) {
                Text(text = "Current plan: ${entitlement.plan}", style = MaterialTheme.typography.titleMedium)
                Text(text = "${entitlement.creditBalance} credits remaining")
                entitlement.trialExpiresAt?.let { Text(text = "Trial ends: ${formatDate(it)}") }
            }
        }

        Text(text = "Plans", style = MaterialTheme.typography.titleMedium)
        PLANS.forEach { plan ->
            JarvisCard(modifier = Modifier.fillMaxWidth()) {
                Text(text = plan.name, style = MaterialTheme.typography.titleMedium)
                Text(text = plan.tagline, style = MaterialTheme.typography.bodyMedium)
            }
        }

        JarvisCard(modifier = Modifier.fillMaxWidth()) {
            Text(text = "Upgrading", style = MaterialTheme.typography.titleMedium)
            Text(
                text = "Live purchases via Google Play Billing are not enabled in this build " +
                    "(no Play Console listing exists for this repository yet — see MASTER_SPEC.md §32). " +
                    "The billing verification endpoint is implemented and ready to wire up.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            JarvisSecondaryButton(text = "Upgrade (coming soon)", onClick = {}, enabled = false)
        }
    }
}

/** Renders a raw ISO-8601 backend timestamp (e.g. "2026-09-09T14:29:38.431Z") as a readable date. */
private fun formatDate(iso: String): String = try {
    val formatter = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.getDefault()).withZone(ZoneId.systemDefault())
    formatter.format(Instant.parse(iso))
} catch (e: DateTimeParseException) {
    iso
}
