package com.zarvismobile.app.navigation

import android.net.Uri
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.zarvismobile.core.ui.components.GlassBottomBar
import com.zarvismobile.core.ui.components.ZarvisNavItem
import com.zarvismobile.feature.conversation.ConversationScreen
import com.zarvismobile.feature.developer.DeveloperScreen
import com.zarvismobile.feature.home.CapabilitiesScreen
import com.zarvismobile.feature.home.HomeScreen
import com.zarvismobile.feature.onboarding.OnboardingScreen
import com.zarvismobile.feature.settings.SettingsScreen
import com.zarvismobile.feature.subscription.SubscriptionScreen
import com.zarvismobile.feature.tasks.MetricsScreen
import com.zarvismobile.feature.tasks.TasksScreen

/** Top-level navigation graph — MASTER_SPEC.md §23. */
object Routes {
    const val ONBOARDING = "onboarding"
    const val HOME = "home"
    const val CAPABILITIES = "capabilities"
    const val METRICS = "metrics"
    const val CONVERSATION = "conversation"
    const val CONVERSATION_ARG_INITIAL_TEXT = "initialText"
    const val TASKS = "tasks"
    const val DEVELOPER = "developer"
    const val SUBSCRIPTION = "subscription"
    const val SETTINGS = "settings"
}

/** The 4 tabs of the floating glass bottom nav (MASTER_SPEC.md §22): Workspace / Capabilities / Plans & Quotas / System Metrics. */
private val BOTTOM_NAV_ITEMS = listOf(
    ZarvisNavItem(route = Routes.HOME, label = "Workspace", icon = Icons.Filled.FlashOn),
    ZarvisNavItem(route = Routes.CAPABILITIES, label = "Capabilities", icon = Icons.Filled.Explore),
    ZarvisNavItem(route = Routes.SUBSCRIPTION, label = "Plans", icon = Icons.Filled.Star),
    ZarvisNavItem(route = Routes.METRICS, label = "Metrics", icon = Icons.Filled.BarChart),
)

@Composable
fun ZarvisNavGraph(startAtOnboarding: Boolean) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val showBottomBar = BOTTOM_NAV_ITEMS.any { it.route == currentRoute }

    Scaffold(
        containerColor = androidx.compose.ui.graphics.Color.Transparent,
        bottomBar = {
            if (showBottomBar) {
                GlassBottomBar(
                    items = BOTTOM_NAV_ITEMS,
                    selectedRoute = currentRoute ?: Routes.HOME,
                    onSelect = { route ->
                        navController.navigate(route) {
                            popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    },
                )
            }
        },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = if (startAtOnboarding) Routes.ONBOARDING else Routes.HOME,
            modifier = Modifier.padding(bottom = innerPadding.calculateBottomPadding()),
        ) {
            composable(Routes.ONBOARDING) {
                OnboardingScreen(
                    onFinished = {
                        navController.navigate(Routes.HOME) {
                            popUpTo(Routes.ONBOARDING) { inclusive = true }
                        }
                    },
                )
            }

            composable(Routes.HOME) {
                HomeScreen(
                    onNavigateToConversation = { initialText ->
                        val encoded = Uri.encode(initialText ?: "")
                        navController.navigate("${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}=$encoded")
                    },
                    onNavigateToTasks = { navController.navigate(Routes.TASKS) },
                    onNavigateToSubscription = { navController.navigate(Routes.SUBSCRIPTION) },
                    onNavigateToDeveloper = { navController.navigate(Routes.DEVELOPER) },
                    onNavigateToSettings = { navController.navigate(Routes.SETTINGS) },
                    onNavigateToCapabilities = { navController.navigate(Routes.CAPABILITIES) },
                )
            }

            composable(Routes.CAPABILITIES) {
                CapabilitiesScreen(
                    onRunSkill = { initialText ->
                        val encoded = Uri.encode(initialText)
                        navController.navigate("${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}=$encoded")
                    },
                )
            }

            composable(Routes.METRICS) { MetricsScreen() }

            composable(
                route = "${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}={${Routes.CONVERSATION_ARG_INITIAL_TEXT}}",
                arguments = listOf(
                    navArgument(Routes.CONVERSATION_ARG_INITIAL_TEXT) {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    },
                ),
            ) { backStackEntry ->
                val raw = backStackEntry.arguments?.getString(Routes.CONVERSATION_ARG_INITIAL_TEXT)
                ConversationScreen(initialText = raw?.takeIf { it.isNotBlank() })
            }

            composable(Routes.TASKS) { TasksScreen() }
            composable(Routes.DEVELOPER) { DeveloperScreen() }
            composable(Routes.SUBSCRIPTION) { SubscriptionScreen() }
            composable(Routes.SETTINGS) {
                SettingsScreen(
                    onSessionCleared = {
                        // Full account switching is planned (MASTER_SPEC.md §29) — clearing the
                        // local session today just returns to Home, where the next app start
                        // bootstraps a fresh trial account.
                        navController.navigate(Routes.HOME) { popUpTo(Routes.HOME) { inclusive = true } }
                    },
                )
            }
        }
    }
}
