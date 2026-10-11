// Pure-Kotlin/JVM module — intentionally has ZERO Android dependency.
// See ARCHITECTURE.md "Why a pure-Kotlin domain module".
plugins {
    kotlin("jvm") version "2.0.21"
}

// Repositories are centralized in settings.gradle.kts (dependencyResolutionManagement).

dependencies {
    implementation(kotlin("stdlib"))
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1")
    // Parses the shared Phase 1 capability registry (shared/capability-registry.json, packaged
    // as a classpath resource below). JsonElement API only — no serialization compiler plugin.
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.1")

    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
}

kotlin {
    jvmToolchain(17)
}

// The single source of truth for capabilities is backend/src/capabilities/registry.ts,
// exported to shared/capability-registry.json. Packaging that exact file as a resource means
// Android reads the same statuses/rationale as Web and the API, with no hand-copied drift.
sourceSets {
    main {
        resources.srcDir("../../shared")
    }
}

tasks.test {
    useJUnitPlatform()
    // NavigationReachabilityTest and WorkCatalogTest read these Android source files. They are inputs, so with the build cache on, changing
    // only one of them still re-runs the tests instead of restoring a result from before the change.
    inputs.files(
        "../app/src/main/kotlin/com/zarvismobile/app/navigation/NavGraph.kt",
        "../features/feature-home/src/main/kotlin/com/zarvismobile/feature/home/FeatureCatalog.kt",
    ).withPropertyName("guardedAndroidSources")
}
