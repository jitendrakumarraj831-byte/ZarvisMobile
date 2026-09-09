plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.ksp)
}

android {
    namespace = "com.zarvismobile.data.local"
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
    // `api`, not `implementation`: this module's own public API is Room-typed — ZarvisDatabase
    // *extends* androidx.room.RoomDatabase and ReminderDao is a @Dao interface — so every
    // consumer that names those types (app's di/AppModule builds the database and injects the
    // DAO) needs Room on its compile classpath to resolve the supertype. With `implementation`
    // Room stops at this module's boundary and consumers fail with
    // "Cannot access 'androidx.room.RoomDatabase' which is a supertype of ZarvisDatabase".
    api(libs.room.runtime)
    implementation(project(":domain"))
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.datastore.preferences)
    implementation(libs.coroutines.core)
}
