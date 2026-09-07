package com.zarvismobile.feature.onboarding

data class OnboardingPage(val title: String, val body: String)

/** Content for the onboarding pages — see MASTER_SPEC.md §15 for the required topics. */
object OnboardingPages {
    val all = listOf(
        OnboardingPage(
            title = "Meet ZARVIS",
            body = "Tell your AI what you want done — in English, Hindi, or Hinglish. It plans the work and gets it done.",
        ),
        OnboardingPage(
            title = "Speak or type",
            body = "Tap the orb and talk, or type your task. ZARVIS understands natural language — no commands to learn.",
        ),
        OnboardingPage(
            title = "Skills, not menus",
            body = "ZARVIS uses specific skills to get things done — search, documents, reminders, and more, growing over time.",
        ),
        OnboardingPage(
            title = "You're always in control",
            body = "Anything risky always asks for your confirmation first. Permissions are requested only when needed, never all at once.",
        ),
        OnboardingPage(
            title = "Your data, your rules",
            body = "You can view, export, or delete anything ZARVIS remembers about you at any time from Settings.",
        ),
        OnboardingPage(
            title = "Start free",
            body = "Your trial unlocks a taste of everything ZARVIS can do. Upgrade any time for more.",
        ),
    )
}
