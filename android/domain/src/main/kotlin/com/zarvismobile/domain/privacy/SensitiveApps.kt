package com.zarvismobile.domain.privacy

/**
 * Apps ZARVIS treats as sensitive. The rules are deliberately conservative: a false positive only hides more, a false negative
 * could expose a code or balance.
 */
object SensitiveApps {
    /** Words in a package name that mark a banking, payment, wallet, trading, authenticator or password-manager app. */
    private val SENSITIVE_PACKAGE_HINTS = listOf(
        "bank", "upi", "wallet", "paypal", "authenticator", "authy", "paytm", "phonepe", "nbu.paisa", "bhim", "mobikwik",
        "freecharge", "okta", "duosecurity", "lastpass", "1password", "bitwarden", "keepass", "dashlane", "nordpass", "enpass",
        "passwordmanager", "groww", "upstox", "trading", "broker",
    )

    /**
     * Banking, payment and trading apps used in India whose package names carry none of the words above, each checked against its
     * Play Store listing (HDFC Bank, YONO SBI and other SBI apps, Axis Mobile, PNB ONE, CRED, Zerodha's apps, Angel One, Samsung
     * Wallet). A prefix ending in "." covers every app of that publisher.
     */
    private val SENSITIVE_PACKAGES = listOf(
        "com.snapwork.hdfc",
        "com.sbi.",
        "com.axis.mobile",
        "com.version1",
        "com.dreamplug.androidapp",
        "com.zerodha.",
        "com.msf.angelmobile",
        "com.samsung.android.spay",
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

    /** Banking, payment, trading, authenticator and password-manager apps (by package name). */
    fun isSensitivePackage(packageName: String): Boolean {
        val pkg = packageName.lowercase()
        return SENSITIVE_PACKAGE_HINTS.any { pkg.contains(it) } ||
            SENSITIVE_PACKAGES.any { known -> if (known.endsWith(".")) pkg.startsWith(known) else pkg == known || pkg.startsWith("$known.") }
    }

    fun isSecuritySurface(packageName: String): Boolean = packageName.lowercase() in SECURITY_SURFACES
}
