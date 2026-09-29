#!/usr/bin/env bash
# Builds the debug app + instrumentation APKs used by the device/emulator verification, with a
# watchdog: if the build makes no progress for ZARVIS_BUILD_TIMEOUT_MIN minutes (default 40),
# it saves thread dumps of the Gradle and Kotlin daemons (what they were stuck on), stops the
# daemons and exits 124 instead of hanging indefinitely.
#
# Usage (from android/):  bash scripts/device/build-apks.sh [extra gradle args…]
#   ZARVIS_DEV_API_HOST / -Pzarvis.devApiHost=…  where the debug app reaches the backend
#   ZARVIS_GRADLE_ARGS="…"                       extra Gradle flags, e.g.
#       -Pkotlin.compiler.execution.strategy=in-process   (compile inside the Gradle daemon,
#        no separate Kotlin daemon; the usual workaround when the Kotlin daemon hangs on Windows)
# Output: build/build-diagnostics/ (gradle log, and thread dumps if it timed out).
set -uo pipefail
cd "$(dirname "$0")/../.."
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

TIMEOUT_MIN="${ZARVIS_BUILD_TIMEOUT_MIN:-40}"
DIAG=build/build-diagnostics
mkdir -p "$DIAG"
LOG="$DIAG/gradle-build.log"
say() { echo "[build-apks] $*"; }

if grep -q $'\r' gradlew 2>/dev/null; then
  say "gradlew has Windows (CRLF) line endings, so bash cannot run it."
  say "Fix (commit or stash your own changes first — this re-checks-out the tree):"
  say "  git config core.autocrlf false && git rm --cached -r -q . && git reset --hard   (see .gitattributes)"
  exit 1
fi

JAVA_BIN="${JAVA_HOME:+$JAVA_HOME/bin/}"
if ! java_version=$("${JAVA_BIN}java" -version 2>&1 | head -1) || [ -z "$java_version" ]; then
  say "java not found. Install JDK 17 and set JAVA_HOME (the build uses jvmToolchain(17))."
  exit 1
fi
say "java: $java_version"
case "$java_version" in
  *'"17'*) ;;
  *) say "note: Gradle runs on this JDK, but the modules compile with a JDK 17 toolchain; if the build says"
     say "      'No matching toolchains found', install JDK 17 and point JAVA_HOME at it." ;;
esac

# A daemon left over from an earlier stuck build can be reused and hang the new one (a new Gradle
# daemon reconnects to a wedged Kotlin compile daemon). Start from fresh daemons unless told not to.
if [ "${ZARVIS_KEEP_DAEMONS:-0}" != 1 ]; then
  say "stopping this project's Gradle daemons and any Kotlin compile daemon (ZARVIS_KEEP_DAEMONS=1 skips this)"
  ./gradlew --stop < /dev/null > /dev/null 2>&1
  while read -r pid name _; do
    case "$name" in *KotlinCompileDaemon*) kill "$pid" 2>/dev/null || taskkill /F /PID "$pid" > /dev/null 2>&1 ;; esac
  done < <("${JAVA_BIN}jps" -l 2>/dev/null)
fi
say "building :app:assembleDebug :app:assembleDebugAndroidTest (watchdog ${TIMEOUT_MIN} min without progress; log: $LOG)"

# shellcheck disable=SC2086
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest --console=plain --profile ${ZARVIS_GRADLE_ARGS:-} "$@" < /dev/null > "$LOG" 2>&1 &
GRADLE_PID=$!

last_size=-1; idle=0; status=""; ticks=0
while kill -0 "$GRADLE_PID" 2>/dev/null; do
  sleep 30
  ticks=$((ticks + 1))
  size=$(wc -c < "$LOG" 2>/dev/null || echo 0)
  if [ "$size" = "$last_size" ]; then idle=$((idle + 30)); else idle=0; last_size=$size; fi
  # Progress line every ~2 minutes: the task Gradle is on right now.
  if [ $((ticks % 4)) -eq 0 ]; then
    task=$(grep -E "^> Task " "$LOG" | tail -1)
    say "… still building (${task:-configuring}); no new output for ${idle}s"
  fi
  if [ "$idle" -ge $((TIMEOUT_MIN * 60)) ]; then
    say "NO PROGRESS for ${TIMEOUT_MIN} min — last task: $(grep -E '^> Task ' "$LOG" | tail -1)"
    say "saving thread dumps of the Gradle and Kotlin daemons to $DIAG/"
    "${JAVA_BIN}jps" -lv > "$DIAG/jps.txt" 2>&1 || true
    while read -r pid name _; do
      case "$name" in
        *GradleDaemon*|*KotlinCompileDaemon*|*GradleWrapperMain*|*GradleWorkerMain*)
          "${JAVA_BIN}jstack" "$pid" > "$DIAG/threads-$pid-${name##*.}.txt" 2>&1 || true ;;
      esac
    done < <("${JAVA_BIN}jps" -l 2>/dev/null)
    ls "$DIAG"
    for f in "$DIAG"/threads-*KotlinCompileDaemon*.txt "$DIAG"/threads-*GradleDaemon*.txt; do
      [ -f "$f" ] || continue
      say "--- $f (main/worker threads) ---"
      grep -A 12 -E '"(main|.*Execution worker.*|.*RMI TCP Connection.*|.*Daemon worker.*)"' "$f" | head -80
    done
    kill "$GRADLE_PID" 2>/dev/null
    ./gradlew --stop > /dev/null 2>&1
    status=124
    break
  fi
done
if [ -z "$status" ]; then wait "$GRADLE_PID"; status=$?; fi

tail -25 "$LOG"
report=$(ls -t build/reports/profile/*.html 2>/dev/null | head -1)
[ -n "$report" ] && say "task timing report: $report"
if [ "$status" = 0 ]; then
  say "APKs:"; ls -l app/build/outputs/apk/debug/app-debug.apk app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
else
  say "build FAILED (exit $status); full log: $LOG"
fi
exit "$status"
