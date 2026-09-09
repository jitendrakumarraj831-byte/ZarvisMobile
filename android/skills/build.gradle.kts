plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.zarvismobile.skills"
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
    // OnDeviceSkillRegistryFactory.create(reminderDao, context) takes a Room DAO from
    // data-local and returns a domain SkillRegistry, so both are part of its public API.
    api(project(":domain"))
    api(project(":data:data-local"))
    implementation(project(":core:core-tooling"))
    implementation(libs.coroutines.core)
}
