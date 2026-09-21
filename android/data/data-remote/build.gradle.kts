plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.zarvismobile.data.remote"
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
    // ApiClientFactory.create(secureStorage, baseUrl) takes SecureStorage in its public
    // signature, so core-security is part of this module's API.
    api(project(":core:core-security"))
    // ZarvisApi.synthesizeSpeech returns retrofit2.Response<okhttp3.ResponseBody> directly
    // (streamed audio bytes, not a DTO) — that leaks both types into this module's public
    // API, so consumers (e.g. app's AndroidTextToSpeechEngine) need them on their own
    // compile classpath too. `implementation` alone doesn't propagate that.
    api(libs.retrofit.core)
    api(libs.okhttp.core)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.coroutines.core)
}
