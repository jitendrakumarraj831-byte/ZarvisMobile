plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.zarvismobile.core.ui"
    compileSdk = 34

    defaultConfig {
        minSdk = 26
    }

    buildFeatures {
        compose = true
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
    // This is a Compose component library: every public declaration in it is Compose-typed
    // (@Composable functions taking Modifier/Color, ZarvisNavItem carrying an ImageVector,
    // the ZarvisTheme entry point), so Compose is `api` here and reaches every consumer that
    // calls into it. The BOM is exported too, so consumers resolve the same Compose versions.
    api(platform(libs.compose.bom))
    api(libs.compose.ui)
    api(libs.compose.material3)
    api(libs.compose.material.icons)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
}
