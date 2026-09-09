plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.zarvismobile.core.tooling"
    compileSdk = 34

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    // The Android*Port classes implement domain ports and ComposeConfirmationPort exposes a
    // StateFlow<PendingConfirmation?> that app's ConfirmationViewModel re-publishes, so both
    // the domain types and coroutines are part of this module's public API.
    api(project(":domain"))
    api(libs.coroutines.core)
}
