#!/usr/bin/env bash
# Builds the debug APK on an Android phone, inside Termux.
#
#   bash android/scripts/termux/assemble-debug.sh                     # the production backend
#   bash android/scripts/termux/assemble-debug.sh https://other.example.com/
#
# Two things differ from a computer, and both are passed per run here rather than committed,
# because the same values would break every other machine:
#   1. Every module compiles with a JDK 17 toolchain (`kotlin { jvmToolchain(17) }`). Gradle looks
#      for toolchains only in the usual desktop folders, and Termux keeps JDKs in $PREFIX/lib/jvm,
#      so a phone with only openjdk-21 stops with "Cannot find a Java installation on your machine
#      ... matching: {languageVersion=17 ...}". Fix: `pkg install openjdk-17` and tell Gradle where
#      it is (org.gradle.java.installations.paths). Gradle itself may keep running on JDK 21.
#   2. The aapt2 that the Android Gradle Plugin downloads from Google's Maven is an x86_64 Linux
#      program and cannot run on an ARM64 phone. Fix: `pkg install aapt2` (a native build) and point
#      the plugin at it (android.aapt2FromMavenOverride).
# The Android SDK (platform 34) must already be installed: sdk.dir in android/local.properties, or
# ANDROID_HOME. The APK talks to the backend over HTTPS (-Pzarvis.apiBaseUrl, app/build.gradle.kts).
set -euo pipefail

fail() { echo "ZARVIS (Termux): $*" >&2; exit 1; }

if [[ "${PREFIX:-}" != *com.termux* ]]; then
  echo "This script is for Termux on Android. On a computer, run ./gradlew :app:assembleDebug in android/ (DEVELOPMENT.md)." >&2
  exit 2
fi

API_BASE_URL="${1:-${ZARVIS_API_BASE_URL:-https://zarvismobile.onrender.com/}}"
ANDROID_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
JDK17="$PREFIX/lib/jvm/java-17-openjdk"
AAPT2="$PREFIX/bin/aapt2"

[ -x "$JDK17/bin/javac" ] || fail "JDK 17 is not installed (looked for $JDK17). Install it with: pkg install openjdk-17"
[ -x "$AAPT2" ] || fail "aapt2 is not installed (looked for $AAPT2). Install it with: pkg install aapt2"
"$AAPT2" version > /dev/null 2>&1 || fail "$AAPT2 is installed but does not run. Reinstall it with: pkg reinstall aapt2"
if [ -z "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] && ! grep -qs '^sdk.dir=' "$ANDROID_DIR/local.properties"; then
  fail "no Android SDK is configured. Set ANDROID_HOME, or put sdk.dir=<path to the SDK> in $ANDROID_DIR/local.properties"
fi

# Gradle runs on the JDK that JAVA_HOME names (17 and 21 both work). A JAVA_HOME left pointing at a
# folder without a JDK ("JAVA_HOME is set to an invalid directory") is replaced by JDK 17.
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "$JAVA_HOME/bin/java" ]; then
  export JAVA_HOME="$JDK17"
fi
echo "Gradle runs on: $JAVA_HOME"
echo "JDK 17 toolchain: $JDK17"
echo "aapt2: $AAPT2 ($("$AAPT2" version 2>&1 | head -n 1))"
echo "Backend: $API_BASE_URL"

cd "$ANDROID_DIR"
./gradlew :app:assembleDebug \
  "-Pzarvis.apiBaseUrl=$API_BASE_URL" \
  "-Porg.gradle.java.installations.paths=$JDK17" \
  "-Pandroid.aapt2FromMavenOverride=$AAPT2" \
  --console=plain
echo "APK: $ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
