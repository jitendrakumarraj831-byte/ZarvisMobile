#!/usr/bin/env bash
# Phase 1 on-device verification driver (run inside the emulator-runner, cwd = android/).
# Installs the app + instrumentation, runs the instrumented tests and the adb lifecycle
# scenarios, and writes all output to build/emulator-evidence/. Exits non-zero on any failure.
set -uo pipefail

API="${1:?api level}"
OUT="build/emulator-evidence"
mkdir -p "$OUT"
APP=com.zarvismobile.app
TEST_PKG=com.zarvismobile.app.test
RUNNER="$TEST_PKG/androidx.test.runner.AndroidJUnitRunner"
FAIL=0

log() { echo "[verify api$API] $*"; }

adb wait-for-device
adb shell getprop ro.build.version.sdk | tee "$OUT/sdk.txt"
adb logcat -c || true
(adb logcat -v time > "$OUT/logcat.txt" 2>&1 &)

log "installing"
adb install -r app/build/outputs/apk/debug/app-debug.apk || { log "install failed"; exit 1; }
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk || { log "test install failed"; exit 1; }

log "instrumented tests"
adb shell am instrument -w -r "$RUNNER" > "$OUT/instrumentation.txt" 2>&1
cat "$OUT/instrumentation.txt"
grep -h "ZARVIS_EVIDENCE" "$OUT/instrumentation.txt" "$OUT/logcat.txt" > "$OUT/evidence.txt" 2>/dev/null || true
if grep -q "FAILURES!!!\|INSTRUMENTATION_FAILED\|Process crashed" "$OUT/instrumentation.txt" || ! grep -q "^OK (" "$OUT/instrumentation.txt"; then
  log "instrumented tests FAILED"
  FAIL=1
fi

for scenario in scripts/emulator/scenarios/*.sh; do
  [ -e "$scenario" ] || continue
  name=$(basename "$scenario" .sh)
  log "scenario $name"
  if bash "$scenario" "$API" "$OUT" > "$OUT/scenario-$name.txt" 2>&1; then
    log "scenario $name PASSED"
  else
    log "scenario $name FAILED"; cat "$OUT/scenario-$name.txt"; FAIL=1
  fi
done

log "evidence:"; cat "$OUT/evidence.txt" || true
exit $FAIL
