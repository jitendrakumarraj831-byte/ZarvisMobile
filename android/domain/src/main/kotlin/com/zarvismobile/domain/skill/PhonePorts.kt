package com.zarvismobile.domain.skill

/**
 * Platform seam for looking up device contacts by name.
 *
 * [search] returns every contact whose name contains [name] (ignoring case): ONE entry per contact, with the number to use for it (see
 * [ContactMatching.collapse]). It promises no order and does not pick between people: choosing, and refusing to guess when a name fits
 * several contacts, is [ContactMatching.bestMatches] and the skills' job.
 */
fun interface ContactLookupPort {
    suspend fun search(name: String): List<PhoneContact>
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
