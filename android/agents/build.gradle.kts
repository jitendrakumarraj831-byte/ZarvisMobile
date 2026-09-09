plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.zarvismobile.agents"
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
    // AndroidOrchestrator's public constructor takes SkillRegistry + ToolPipeline (domain)
    // and ZarvisApi (data-remote), and app's di/AppModule calls it directly.
    api(project(":domain"))
    api(project(":data:data-remote"))
    implementation(libs.coroutines.core)
}
