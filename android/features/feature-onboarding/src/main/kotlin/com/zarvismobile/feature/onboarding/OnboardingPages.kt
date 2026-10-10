package com.zarvismobile.feature.onboarding

import com.zarvismobile.domain.presentation.UiString

data class OnboardingPage(val title: UiString, val body: UiString)

/**
 * Content for the onboarding pages — see MASTER_SPEC.md §15 for the required topics. Page 5 only promises what the app does:
 * seeing and deleting what ZARVIS saved (Settings > Memory) and deleting the account. There is no data export, and it says so.
 */
object OnboardingPages {
    val all = listOf(
        OnboardingPage(UiString.ONBOARDING_1_TITLE, UiString.ONBOARDING_1_BODY),
        OnboardingPage(UiString.ONBOARDING_2_TITLE, UiString.ONBOARDING_2_BODY),
        OnboardingPage(UiString.ONBOARDING_3_TITLE, UiString.ONBOARDING_3_BODY),
        OnboardingPage(UiString.ONBOARDING_4_TITLE, UiString.ONBOARDING_4_BODY),
        OnboardingPage(UiString.ONBOARDING_5_TITLE, UiString.ONBOARDING_5_BODY),
        OnboardingPage(UiString.ONBOARDING_6_TITLE, UiString.ONBOARDING_6_BODY),
    )
}
