package com.zarvismobile.app.navigation

import android.net.Uri
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.lifecycle.Lifecycle
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.zarvismobile.core.ui.components.GlassBottomBar
import com.zarvismobile.core.ui.components.ZarvisNavItem
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.icons.ZarvisIcons
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
    const val PHONE_SAFETY = "settings/phone-safety"
    const val FEATURE = "feature/{featureId}"
    const val FEATURE_ARG = "featureId"
}

/** The five tabs (blueprint §4), named in the app's language. Five equal tabs, Chat in the middle (ANDROID_QUEEN_DESIGN.md, Queen Pro). */
@Composable
private fun bottomNavItems(): List<ZarvisNavItem> = listOf(
    // The website's icons (core-ui ZarvisIcons, generated from web/index.html), so the two apps share one icon language.
    ZarvisNavItem(Routes.HOME, tr(UiString.NAV_HOME), ZarvisIcons.Home),
    ZarvisNavItem(Routes.CAPABILITIES, tr(UiString.NAV_CAPABILITIES), ZarvisIcons.Grid),
    ZarvisNavItem(Routes.CHAT, tr(UiString.NAV_CHAT), ZarvisIcons.Chat),
    ZarvisNavItem(Routes.ACTIVITY, tr(UiString.NAV_TASKS), ZarvisIcons.Task),
    ZarvisNavItem(Routes.MORE, tr(UiString.NAV_WORK), ZarvisIcons.Folder),
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
    // derivedStateOf: the graph recomposes when the keyboard opens or closes, not on every frame of its slide.
    val density = LocalDensity.current
    val imeInsets = WindowInsets.ime
    val keyboardOpen by remember { derivedStateOf { imeInsets.getBottom(density) > 0 } }
    val showBottomBar = navItems.any { it.route == selectedRoute } && !keyboardOpen

    Scaffold(
        containerColor = androidx.compose.ui.graphics.Color.Transparent,
        bottomBar = {
            if (showBottomBar) {
                GlassBottomBar(
                    items = navItems,
                    selectedRoute = selectedRoute,
                    onSelect = { route ->
                        // Tapping the tab that is already highlighted while a screen opened from it (Work > Memory) is showing goes back to the
                        // tab's own page. Navigating to it would restore the saved stack, which still ends on that child screen.
                        val backAtTab = route == selectedRoute && currentRoute != route && navController.popBackStack(route, false)
                        if (!backAtTab) {
                            navController.navigate(route) {
                                // HOME, not the graph's start: in a new user's first session the start is the onboarding, which is no longer on the
                                // stack, so popping to it did nothing and every tab visited piled up behind Back.
                                popUpTo(Routes.HOME) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
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
            composable(Routes.HOME) { entry ->
                HomeScreen(
                    onNavigateToConversation = { initialText ->
                        val encoded = Uri.encode(initialText ?: "")
                        navController.openFrom(entry, "${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}=$encoded&submit=true&listen=false")
                    },
                    onNavigateToTasks = { navController.openFrom(entry, Routes.ACTIVITY) },
                    onNavigateToSubscription = { navController.openFrom(entry, Routes.SUBSCRIPTION) },
                    onNavigateToSettings = { navController.openFrom(entry, Routes.SETTINGS) },
                    onOpenPhoneSafety = { navController.openFrom(entry, Routes.PHONE_SAFETY) },
                    onOpenFeature = { featureId -> navController.openFrom(entry, "feature/$featureId") },
                    // The crowned orb and the composer's mic: Chat, listening at once (after ZARVIS's explanation and Android's permission).
                    onTalk = { navController.openFrom(entry, "${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}=&submit=false&listen=true") },
                )
            }
            composable(Routes.CHAT) { ConversationScreen(initialText = null) }
            composable(Routes.CAPABILITIES) { entry ->
                CapabilitiesScreen(
                    onRunSkill = { initialText ->
                        val encoded = Uri.encode(initialText)
                        navController.openFrom(entry, "${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}=$encoded&submit=true&listen=false")
                    },
                    onOpenFeature = { featureId -> navController.openFrom(entry, "feature/$featureId") },
                    onOpenPlans = { navController.openFrom(entry, Routes.SUBSCRIPTION) },
                )
            }
            composable(Routes.MORE) { entry ->
                MoreScreen(
                    onOpenScreen = { screen -> navController.openFrom(entry, routeFor(screen)) },
                    onOpenFeature = { featureId -> navController.openFrom(entry, "feature/$featureId") },
                )
            }
            composable(Routes.ACTIVITY) { entry ->
                TasksScreen(
                    onOpenPlans = { navController.openFrom(entry, Routes.SUBSCRIPTION) },
                    onOpenTasksFeature = { navController.openFrom(entry, "feature/tasks") },
                    onOpenChat = { navController.openFrom(entry, "${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}=&submit=false&listen=false") },
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
                        navController.openFrom(entry, "${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}=$encoded&submit=false&listen=$listen")
                    },
                    onOpenDeveloper = { navController.openFrom(entry, Routes.DEVELOPER) },
                    onOpenPhoneSafety = { navController.openFrom(entry, Routes.PHONE_SAFETY) },
                )
            }
            composable(Routes.METRICS) { MetricsScreen(onBack = { navController.popBackStack() }) }
            composable(Routes.TASKS) { entry ->
                TasksScreen(
                    onOpenPlans = { navController.openFrom(entry, Routes.SUBSCRIPTION) },
                    onOpenTasksFeature = { navController.openFrom(entry, "feature/tasks") },
                    onOpenChat = { navController.openFrom(entry, "${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}=&submit=false&listen=false") },
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
            composable(Routes.SETTINGS) { entry ->
                SettingsScreen(
                    onBack = { navController.popBackStack() },
                    onSessionCleared = {
                        navController.navigate(Routes.HOME) {
                            popUpTo(Routes.HOME) { inclusive = true }
                        }
                    },
                    onDeveloper = { navController.openFrom(entry, Routes.DEVELOPER) },
                )
            }
            // Home's "Phone action safety" row opens that settings page directly; Back returns to Home.
            composable(Routes.PHONE_SAFETY) { entry ->
                SettingsScreen(
                    onBack = { navController.popBackStack() },
                    onSessionCleared = {
                        navController.navigate(Routes.HOME) {
                            popUpTo(Routes.HOME) { inclusive = true }
                        }
                    },
                    onDeveloper = { navController.openFrom(entry, Routes.DEVELOPER) },
                    openPhoneSafety = true,
                )
            }
        }
    }
}

/**
 * Navigates only while [from] is the screen in front. During its exit animation the screen being left still takes taps, so a double
 * tap on a category chip or Run opened Chat twice and sent the request twice (two AI turns).
 */
private fun NavController.openFrom(from: NavBackStackEntry, route: String) {
    if (from.lifecycle.currentState == Lifecycle.State.RESUMED) navigate(route)
}
