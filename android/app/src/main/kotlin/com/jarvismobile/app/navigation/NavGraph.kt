package com.jarvismobile.app.navigation

import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.jarvismobile.feature.conversation.ConversationScreen
import com.jarvismobile.feature.developer.DeveloperScreen
import com.jarvismobile.feature.home.HomeScreen
import com.jarvismobile.feature.onboarding.OnboardingScreen
import com.jarvismobile.feature.settings.SettingsScreen
import com.jarvismobile.feature.subscription.SubscriptionScreen
import com.jarvismobile.feature.tasks.TasksScreen

/** Top-level navigation graph — MASTER_SPEC.md §23. */
object Routes {
    const val ONBOARDING = "onboarding"
    const val HOME = "home"
    const val CONVERSATION = "conversation"
    const val CONVERSATION_ARG_INITIAL_TEXT = "initialText"
    const val TASKS = "tasks"
    const val DEVELOPER = "developer"
    const val SUBSCRIPTION = "subscription"
    const val SETTINGS = "settings"
}

@Composable
fun JarvisNavGraph(startAtOnboarding: Boolean) {
    val navController = rememberNavController()

    NavHost(
        navController = navController,
        startDestination = if (startAtOnboarding) Routes.ONBOARDING else Routes.HOME,
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
            )
        }

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
