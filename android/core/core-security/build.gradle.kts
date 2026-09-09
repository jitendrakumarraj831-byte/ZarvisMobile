plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.zarvismobile.core.security"
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
    // AndroidPermissionPort *implements* the domain's PermissionPort, so the domain type is
    // part of this module's public API and must reach consumers.
    api(project(":domain"))
    implementation(libs.core.ktx)
    implementation(libs.security.crypto)
    implementation(libs.coroutines.core)
}
