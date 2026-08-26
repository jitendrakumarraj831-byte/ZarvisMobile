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
    const val CONVERSATION_ARG_AUTO_LISTEN = "autoListen"
    const val CONVERSATION_ARG_PREFILL_TEXT = "prefillText"
    const val TASKS = "tasks"
    const val DEVELOPER = "developer"
    const val SUBSCRIPTION = "subscription"
    const val SETTINGS = "settings"
}

/**
 * @param onSessionCleared called when the user clears their local session from Settings —
 * wired by the caller to the app-level startup gate's retry/bootstrap, so a cleared session
 * actually gets a fresh account instead of leaving the app authenticated against tokens that
 * no longer exist (see `app/AppStartupViewModel.kt`).
 */
@Composable
fun JarvisNavGraph(startAtOnboarding: Boolean, onSessionCleared: () -> Unit) {
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
                onStartVoice = {
                    navController.navigate("${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_AUTO_LISTEN}=true")
                },
                onSubmitText = { text ->
                    navController.navigate("${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}=${Uri.encode(text)}")
                },
                onPrefillText = { text ->
                    navController.navigate("${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_PREFILL_TEXT}=${Uri.encode(text)}")
                },
                onNavigateToTasks = { navController.navigate(Routes.TASKS) },
                onNavigateToSubscription = { navController.navigate(Routes.SUBSCRIPTION) },
                onNavigateToDeveloper = { navController.navigate(Routes.DEVELOPER) },
                onNavigateToSettings = { navController.navigate(Routes.SETTINGS) },
            )
        }

        composable(
            route = "${Routes.CONVERSATION}?${Routes.CONVERSATION_ARG_INITIAL_TEXT}={${Routes.CONVERSATION_ARG_INITIAL_TEXT}}" +
                "&${Routes.CONVERSATION_ARG_AUTO_LISTEN}={${Routes.CONVERSATION_ARG_AUTO_LISTEN}}" +
                "&${Routes.CONVERSATION_ARG_PREFILL_TEXT}={${Routes.CONVERSATION_ARG_PREFILL_TEXT}}",
            arguments = listOf(
                navArgument(Routes.CONVERSATION_ARG_INITIAL_TEXT) {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                },
                navArgument(Routes.CONVERSATION_ARG_AUTO_LISTEN) {
                    type = NavType.BoolType
                    defaultValue = false
                },
                navArgument(Routes.CONVERSATION_ARG_PREFILL_TEXT) {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                },
            ),
        ) { backStackEntry ->
            val initialText = backStackEntry.arguments?.getString(Routes.CONVERSATION_ARG_INITIAL_TEXT)?.takeIf { it.isNotBlank() }
            val autoListen = backStackEntry.arguments?.getBoolean(Routes.CONVERSATION_ARG_AUTO_LISTEN) ?: false
            val prefillText = backStackEntry.arguments?.getString(Routes.CONVERSATION_ARG_PREFILL_TEXT)?.takeIf { it.isNotBlank() }
            ConversationScreen(initialText = initialText, autoListen = autoListen, prefillText = prefillText)
        }

        composable(Routes.TASKS) { TasksScreen() }
        composable(Routes.DEVELOPER) { DeveloperScreen() }
        composable(Routes.SUBSCRIPTION) { SubscriptionScreen() }
        composable(Routes.SETTINGS) {
            SettingsScreen(onSessionCleared = onSessionCleared)
        }
    }
}
