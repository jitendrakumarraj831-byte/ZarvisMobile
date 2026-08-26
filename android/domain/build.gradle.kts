// Pure-Kotlin/JVM module — intentionally has ZERO Android dependency.
// See ARCHITECTURE.md "Why a pure-Kotlin domain module".
plugins {
    kotlin("jvm") version "2.0.21"
}

// Repositories are centralized in settings.gradle.kts (dependencyResolutionManagement).

dependencies {
    implementation(kotlin("stdlib"))
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1")

    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
}

kotlin {
    jvmToolchain(21)
}

tasks.test {
    useJUnitPlatform()
}
