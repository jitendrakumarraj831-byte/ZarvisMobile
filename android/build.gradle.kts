// Root build file — deliberately declares NO plugins.
//
// The root project's build.gradle.kts is always evaluated by Gradle, even when
// org.gradle.configureondemand=true is set (unlike leaf modules, which are only
// configured when relevant to the requested task). If a plugin were declared here
// (even with `apply false`), Gradle would try to resolve it on every invocation —
// including `./gradlew :domain:build`, which must succeed without the Android SDK/AGP
// available (see ../DEVELOPMENT.md). Plugin versions are centralized instead in
// gradle/libs.versions.toml (a version catalog, which is inert data until a specific
// module applies one of its plugin aliases), and each Android module applies its own
// plugins directly in its own build.gradle.kts.
