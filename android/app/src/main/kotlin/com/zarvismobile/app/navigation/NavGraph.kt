package com.zarvismobile.app.navigation

import android.net.Uri
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.Home
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

object Routes {
    const val ONBOARDING = "onboarding"
    const val HOME = "home"
    const val CHAT = "chat"
    const val CAPABILITIES = "capabilities"
    const val METRICS = "metrics"
    const val ACTIVITY = "activity"
    const val CONVERSATION = "conversation"
    const val CONVERSATION_ARG_INITIAL_TEXT = "initialText"
    const val TASKS = "tasks"
    const val DEVELOPER = "developer"
    const val SUBSCRIPTION = "subscription"
    const val SETTINGS = "settings"
}

private val BOTTOM_NAV_ITEMS = listOf(
    ZarvisNavItem(Routes.HOME, "Home", Icons.Filled.Home),
    ZarvisNavItem(Routes.CHAT, "Chat", Icons.Filled.ChatBubble),
    ZarvisNavItem(Routes.CAPABILITIES, "Features", Icons.Filled.Explore),
    ZarvisNavItem(Routes.ACTIVITY, "Activity", Icons.Filled.BarChart),
)

@Composable
fun ZarvisNavGraph(startAtOnboarding: Boolean) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val selectedRoute = when (currentRoute) {
        Routes.METRICS, Routes.TASKS -> Routes.ACTIVITY
        else -> currentRoute ?: Routes.HOME
    }
    val showBottomBar = BOTTOM_NAV_ITEMS.any { it.route == selectedRoute }

    Scaffold(
        containerColor = androidx.compose.ui.graphics.Color.Transparent,
        bottomBar = {
            if (showBottomBar) {
                GlassBottomBar(
                    items = BOTTOM_NAV_ITEMS,
                    selectedRoute = selectedRoute,
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
                    onNavigateToTasks = { navController.navigate(Routes.ACTIVITY) },
                    onNavigateToSubscription = { navController.navigate(Routes.SUBSCRIPTION) },
                    onNavigateToDeveloper = { navController.navigate(Routes.DEVELOPER) },
                    onNavigateToSettings = { navController.navigate(Routes.SETTINGS) },
                    onNavigateToCapabilities = { navController.navigate(Routes.CAPABILITIES) },
                )
            }
            composable(Routes.CHAT) { ConversationScreen(initialText = null) }
            composable(Routes.CAPABILITIES) {
                CapabilitiesScreen(
                    onRunSkill = { initialText ->
                        val encoded = Uri.encode(initialText)
                        navController.navigate("${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}=$encoded")
                    },
                )
            }
            composable(Routes.ACTIVITY) { MetricsScreen() }
            composable(Routes.METRICS) { MetricsScreen() }
            composable(Routes.TASKS) { TasksScreen() }
            composable(
                route = "${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}={${Routes.CONVERSATION_ARG_INITIAL_TEXT}}",
                arguments = listOf(
                    navArgument(Routes.CONVERSATION_ARG_INITIAL_TEXT) {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    },
                ),
            ) { backStackEntryArg ->
                val raw = backStackEntryArg.arguments?.getString(Routes.CONVERSATION_ARG_INITIAL_TEXT)
                ConversationScreen(initialText = raw?.takeIf { it.isNotBlank() })
            }
            composable(Routes.DEVELOPER) { DeveloperScreen() }
            composable(Routes.SUBSCRIPTION) { SubscriptionScreen() }
            composable(Routes.SETTINGS) {
                SettingsScreen(
                    onSessionCleared = {
                        navController.navigate(Routes.HOME) {
                            popUpTo(Routes.HOME) { inclusive = true }
                        }
                    },
                    onDeveloper = { navController.navigate(Routes.DEVELOPER) },
                )
            }
        }
    }
}