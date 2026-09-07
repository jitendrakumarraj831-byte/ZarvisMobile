package com.zarvismobile.domain.skill

/** Platform seam for looking up a device contact by (partial, case-insensitive) name. */
fun interface ContactLookupPort {
    suspend fun findByName(name: String): PhoneContact?
}

data class PhoneContact(val displayName: String, val phoneNumber: String)

/** Platform seam for launching another installed app. */
fun interface AppLauncherPort {
    suspend fun openApp(appName: String): AppLaunchResult
}

sealed interface AppLaunchResult {
    data class Opened(val appName: String) : AppLaunchResult
    data object NotFound : AppLaunchResult
}

/** Platform seam for placing a phone call. Android implements this over `Intent.ACTION_CALL`. */
fun interface PhoneCallPort {
    /** Returns true if the call was actually placed. */
    suspend fun call(phoneNumber: String): Boolean
}
