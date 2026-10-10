package com.zarvismobile.app.navigation

import android.net.Uri
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.Home
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.zarvismobile.core.ui.components.GlassBottomBar
import com.zarvismobile.core.ui.components.ZarvisNavItem
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.domain.presentation.UiString
import com.zarvismobile.domain.presentation.WorkScreen
import com.zarvismobile.feature.conversation.ConversationScreen
import com.zarvismobile.feature.developer.DeveloperScreen
import com.zarvismobile.feature.home.CapabilitiesScreen
import com.zarvismobile.feature.home.FeatureDetailScreen
import com.zarvismobile.feature.home.HomeScreen
import com.zarvismobile.feature.home.MoreScreen
import com.zarvismobile.feature.onboarding.OnboardingScreen
import com.zarvismobile.feature.settings.MemoryScreen
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
    const val MORE = "more"
    const val CONVERSATION = "conversation"
    const val CONVERSATION_ARG_INITIAL_TEXT = "initialText"
    const val TASKS = "tasks"
    const val MEMORY = "memory"
    const val DEVELOPER = "developer"
    const val SUBSCRIPTION = "subscription"
    const val SETTINGS = "settings"
    const val FEATURE = "feature/{featureId}"
    const val FEATURE_ARG = "featureId"
}

/** The five tabs (blueprint §4), named in the app's language. */
@Composable
private fun bottomNavItems(): List<ZarvisNavItem> = listOf(
    ZarvisNavItem(Routes.HOME, tr(UiString.NAV_HOME), Icons.Filled.Home),
    ZarvisNavItem(Routes.CHAT, tr(UiString.NAV_CHAT), Icons.Filled.ChatBubble),
    ZarvisNavItem(Routes.CAPABILITIES, tr(UiString.NAV_CAPABILITIES), Icons.Filled.Explore),
    ZarvisNavItem(Routes.ACTIVITY, tr(UiString.NAV_TASKS), Icons.AutoMirrored.Filled.List),
    ZarvisNavItem(Routes.MORE, tr(UiString.NAV_WORK), Icons.Filled.Apps),
)

/** The screen each Work card opens. Every route is reachable from the Work tab (NavigationReachabilityTest checks this). */
private fun routeFor(screen: WorkScreen): String = when (screen) {
    WorkScreen.TASKS -> Routes.TASKS
    WorkScreen.MEMORY -> Routes.MEMORY
    WorkScreen.METRICS -> Routes.METRICS
    WorkScreen.PLANS -> Routes.SUBSCRIPTION
    WorkScreen.DEVELOPER -> Routes.DEVELOPER
    WorkScreen.SETTINGS -> Routes.SETTINGS
}

@Composable
fun ZarvisNavGraph(startAtOnboarding: Boolean) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val navItems = bottomNavItems()
    // The screens opened from the Work tab keep it highlighted (and the tab bar visible) while they are open.
    val selectedRoute = when (currentRoute) {
        Routes.METRICS, Routes.TASKS, Routes.MEMORY -> Routes.MORE
        else -> currentRoute ?: Routes.HOME
    }
    // The tab bar sits behind the keyboard, so while typing it is only dead space between the composer and the keys: hide it.
    val keyboardOpen = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    val showBottomBar = navItems.any { it.route == selectedRoute } && !keyboardOpen

    Scaffold(
        containerColor = androidx.compose.ui.graphics.Color.Transparent,
        bottomBar = {
            if (showBottomBar) {
                GlassBottomBar(
                    items = navItems,
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
        // The Scaffold already pads for the tab bar (or, with no bar, for the gesture/navigation bar). Mark that space as taken so a
        // screen's own navigationBarsPadding()/imePadding() does not add the same inset a second time above the composer or buttons.
        val bottomPadding = PaddingValues(bottom = innerPadding.calculateBottomPadding())
        NavHost(
            navController = navController,
            startDestination = if (startAtOnboarding) Routes.ONBOARDING else Routes.HOME,
            modifier = Modifier.padding(bottomPadding).consumeWindowInsets(bottomPadding),
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
                        navController.navigate("${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}=$encoded&submit=true&listen=false")
                    },
                    onNavigateToTasks = { navController.navigate(Routes.ACTIVITY) },
                    onNavigateToSubscription = { navController.navigate(Routes.SUBSCRIPTION) },
                    onNavigateToDeveloper = { navController.navigate(Routes.DEVELOPER) },
                    onNavigateToSettings = { navController.navigate(Routes.SETTINGS) },
                    onNavigateToCapabilities = { navController.navigate(Routes.CAPABILITIES) },
                    onOpenFeature = { featureId -> navController.navigate("feature/$featureId") },
                )
            }
            composable(Routes.CHAT) { ConversationScreen(initialText = null) }
            composable(Routes.CAPABILITIES) {
                CapabilitiesScreen(
                    onRunSkill = { initialText ->
                        val encoded = Uri.encode(initialText)
                        navController.navigate("${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}=$encoded&submit=true&listen=false")
                    },
                    onOpenFeature = { featureId -> navController.navigate("feature/$featureId") },
                    onOpenPlans = { navController.navigate(Routes.SUBSCRIPTION) },
                )
            }
            composable(Routes.MORE) {
                MoreScreen(
                    onOpenScreen = { screen -> navController.navigate(routeFor(screen)) },
                    onOpenFeature = { featureId -> navController.navigate("feature/$featureId") },
                )
            }
            composable(Routes.ACTIVITY) {
                TasksScreen(
                    onOpenPlans = { navController.navigate(Routes.SUBSCRIPTION) },
                    onOpenTasksFeature = { navController.navigate("feature/tasks") },
                )
            }
            composable(
                route = "feature/{${Routes.FEATURE_ARG}}",
                arguments = listOf(navArgument(Routes.FEATURE_ARG) { type = NavType.StringType }),
            ) { entry ->
                FeatureDetailScreen(
                    featureId = entry.arguments?.getString(Routes.FEATURE_ARG).orEmpty(),
                    onBack = { navController.popBackStack() },
                    onStartChat = { prompt, listen ->
                        val encoded = Uri.encode(prompt)
                        navController.navigate("${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}=$encoded&submit=false&listen=$listen")
                    },
                    onOpenDeveloper = { navController.navigate(Routes.DEVELOPER) },
                )
            }
            composable(Routes.METRICS) { MetricsScreen(onBack = { navController.popBackStack() }) }
            composable(Routes.TASKS) {
                TasksScreen(
                    onOpenPlans = { navController.navigate(Routes.SUBSCRIPTION) },
                    onOpenTasksFeature = { navController.navigate("feature/tasks") },
                    onBack = { navController.popBackStack() },
                )
            }
            composable(Routes.MEMORY) { MemoryScreen(onBack = { navController.popBackStack() }) }
            composable(
                route = "${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}={${Routes.CONVERSATION_ARG_INITIAL_TEXT}}&submit={submit}&listen={listen}",
                arguments = listOf(
                    navArgument(Routes.CONVERSATION_ARG_INITIAL_TEXT) {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    },
                    navArgument("submit") {
                        type = NavType.BoolType
                        defaultValue = true
                    },
                    navArgument("listen") {
                        type = NavType.BoolType
                        defaultValue = false
                    },
                ),
            ) { backStackEntryArg ->
                val raw = backStackEntryArg.arguments?.getString(Routes.CONVERSATION_ARG_INITIAL_TEXT)
                ConversationScreen(
                    initialText = raw?.takeIf { it.isNotBlank() },
                    submitInitialText = backStackEntryArg.arguments?.getBoolean("submit") ?: true,
                    listenOnStart = backStackEntryArg.arguments?.getBoolean("listen") ?: false,
                    onBack = { navController.popBackStack() },
                )
            }
            composable(Routes.DEVELOPER) { DeveloperScreen(onBack = { navController.popBackStack() }) }
            composable(Routes.SUBSCRIPTION) { SubscriptionScreen(onBack = { navController.popBackStack() }) }
            composable(Routes.SETTINGS) {
                SettingsScreen(
                    onBack = { navController.popBackStack() },
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