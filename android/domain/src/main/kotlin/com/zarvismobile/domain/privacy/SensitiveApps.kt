package com.zarvismobile.domain.privacy

/**
 * Apps ZARVIS treats as sensitive. The package heuristics are deliberately conservative: a
 * false positive only hides more, a false negative could expose a code or balance.
 */
object SensitiveApps {
    private val SENSITIVE_PACKAGE_HINTS = listOf(
        "bank", "upi", "wallet", "authenticator", "paytm", "phonepe", "nbu.paisa", "bhim", "okta", "duosecurity",
        "lastpass", "1password", "bitwarden", "keepass", "dashlane", "passwordmanager",
    )

    /**
     * System surfaces where a tap could grant permissions, install software or change security
     * settings. ZARVIS never taps inside them — using accessibility to approve its own access
     * would bypass Android's security model.
     */
    private val SECURITY_SURFACES = setOf(
        "com.android.settings",
        "com.android.permissioncontroller",
        "com.google.android.permissioncontroller",
        "com.android.packageinstaller",
        "com.google.android.packageinstaller",
        "com.android.systemui",
        "com.android.vending",
        "com.google.android.gms",
        "com.android.keychain",
        "com.android.certinstaller",
    )

    /** Banking, payment, authenticator and password-manager apps (by package heuristics). */
    fun isSensitivePackage(packageName: String): Boolean {
        val pkg = packageName.lowercase()
        return SENSITIVE_PACKAGE_HINTS.any { pkg.contains(it) }
    }

    fun isSecuritySurface(packageName: String): Boolean = packageName.lowercase() in SECURITY_SURFACES
}
