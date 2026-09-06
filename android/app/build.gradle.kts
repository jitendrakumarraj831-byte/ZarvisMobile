plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

android {
    namespace = "com.zarvismobile.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.zarvismobile.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        // API_BASE_URL previously had no way to be set at all — ApiClientFactory's default
        // (10.0.2.2, the Android emulator's alias for the host machine's localhost) was the
        // *only* value ever used, in every build type, so a release build on a real device
        // could never reach the deployed backend. debug keeps the emulator-local default
        // (matches DEVELOPMENT.md's `npm run dev` local workflow); release points at the
        // production domain the web client already uses (MASTER_SPEC.md §12a).
        debug {
            buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:3000/\"")
        }
        release {
            isMinifyEnabled = false
            buildConfigField("String", "API_BASE_URL", "\"https://zarvismobile.com/\"")
        }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(project(":domain"))
    implementation(project(":agents"))
    implementation(project(":skills"))
    implementation(project(":core:core-ui"))
    implementation(project(":core:core-common"))
    implementation(project(":core:core-security"))
    implementation(project(":core:core-tooling"))
    implementation(project(":data:data-remote"))
    implementation(project(":data:data-local"))
    implementation(project(":data:data-repository"))
    implementation(project(":features:feature-onboarding"))
    implementation(project(":features:feature-home"))
    implementation(project(":features:feature-conversation"))
    implementation(project(":features:feature-tasks"))
    implementation(project(":features:feature-developer"))
    implementation(project(":features:feature-subscription"))
    implementation(project(":features:feature-settings"))

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.activity.compose)
    implementation(libs.core.ktx)
    implementation(libs.navigation.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)

    implementation(libs.hilt.android)
    implementation(libs.hilt.navigation.compose)
    ksp(libs.hilt.compiler)

    implementation(libs.coroutines.core)
    implementation(libs.coroutines.android)
}
