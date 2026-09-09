plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.zarvismobile.core.common"
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
    // Public API is coroutine-typed (DispatcherProvider exposes CoroutineDispatcher,
    // SpeechToTextEngine returns Flow, TurnMetricsStore exposes StateFlow), so coroutines
    // belong on `api` rather than stopping at this module's boundary.
    api(libs.coroutines.core)
    implementation(libs.coroutines.android)
}
