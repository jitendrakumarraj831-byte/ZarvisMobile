package com.zarvismobile.feature.subscription

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
import com.zarvismobile.core.ui.components.ZarvisCard
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.theme.ZarvisSpacing

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
        modifier = Modifier.fillMaxSize().padding(ZarvisSpacing.md),
        verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.md),
    ) {
        Text(text = "Subscription", style = MaterialTheme.typography.headlineMedium)

        if (uiState.isLoading) CircularProgressIndicator()
        uiState.error?.let { Text(text = it, color = MaterialTheme.colorScheme.error) }

        uiState.entitlement?.let { entitlement ->
            ZarvisCard(modifier = Modifier.fillMaxWidth()) {
                Text(text = "Current plan: ${entitlement.plan}", style = MaterialTheme.typography.titleMedium)
                Text(text = "${entitlement.creditBalance} credits remaining")
                entitlement.trialExpiresAt?.let { Text(text = "Trial ends: $it") }
            }
        }

        Text(text = "Plans", style = MaterialTheme.typography.titleMedium)
        PLANS.forEach { plan ->
            ZarvisCard(modifier = Modifier.fillMaxWidth()) {
                Text(text = plan.name, style = MaterialTheme.typography.titleMedium)
                Text(text = plan.tagline, style = MaterialTheme.typography.bodyMedium)
            }
        }

        ZarvisCard(modifier = Modifier.fillMaxWidth()) {
            Text(text = "Upgrading", style = MaterialTheme.typography.titleMedium)
            Text(
                text = "Live purchases via Google Play Billing are not enabled in this build " +
                    "(no Play Console listing exists for this repository yet — see MASTER_SPEC.md §32). " +
                    "The billing verification endpoint is implemented and ready to wire up.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            ZarvisSecondaryButton(text = "Upgrade (coming soon)", onClick = {}, enabled = false)
        }
    }
}
