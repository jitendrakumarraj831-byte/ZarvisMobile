plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.zarvismobile.data.repository"
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
    // RemoteEntitlementPort/RemoteUsagePort implement domain ports, and SessionRepository's
    // public constructor takes ZarvisApi and SecureStorage — all three are in this module's
    // API, and app's di/AppModule constructs them by name.
    api(project(":domain"))
    api(project(":data:data-remote"))
    api(project(":core:core-security"))
    implementation(libs.coroutines.core)
}
