pluginManagement {
    repositories {
        google()
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "zarvis-mobile"

// Pure-Kotlin core — builds/tests on plain JVM, no Android SDK required.
// See ../DEVELOPMENT.md and MASTER_SPEC.md §31.
include(":domain")

// Android application modules — require the Android SDK (Android Studio) to build.
// Listed here to match MASTER_SPEC.md §8; not configured when building only :domain
// because org.gradle.configureondemand=true (see gradle.properties) skips configuring
// modules unrelated to the requested task.
include(":app")
include(":core:core-ui")
include(":core:core-common")
include(":core:core-security")
include(":core:core-tooling")
include(":data:data-remote")
include(":data:data-local")
include(":data:data-repository")
include(":agents")
include(":skills")
include(":features:feature-onboarding")
include(":features:feature-home")
include(":features:feature-conversation")
include(":features:feature-tasks")
include(":features:feature-developer")
include(":features:feature-subscription")
include(":features:feature-settings")
