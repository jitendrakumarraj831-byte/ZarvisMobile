#!/usr/bin/env bash
# Phase 1 on-device verification driver (run inside the emulator-runner, cwd = android/).
# Installs the app + instrumentation and runs, in order:
#   A. fresh-install permission flows (real runtime dialogs)
#   B. process death while an action waits on the user (two separate processes)
#   C. adb lifecycle scenarios (revocation kills the process)
#   D. special access + device capabilities against the real system services
# All output goes to build/emulator-evidence/; exits non-zero on any failure.
set -uo pipefail

API="${1:?api level}"
OUT="build/emulator-evidence"
mkdir -p "$OUT"
APP=com.zarvismobile.app
RUNNER="$APP.test/androidx.test.runner.AndroidJUnitRunner"
FAIL=0
log() { echo "[verify api$API] $*"; }

adb wait-for-device
adb shell getprop ro.build.version.sdk | tee "$OUT/sdk.txt"
adb logcat -c || true
(adb logcat -v time > "$OUT/logcat.txt" 2>&1 &)
adb shell settings put system screen_off_timeout 1800000 || true
adb shell svc power stayon true || true
adb shell wm dismiss-keyguard || true

log "installing"
adb install -r app/build/outputs/apk/debug/app-debug.apk || { log "install failed"; exit 1; }
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk || { log "test install failed"; exit 1; }
# Emulator GPS fix for the location check (Forbesganj, Bihar).
adb emu geo fix 87.2677 26.2987 || true

# run_classes NAME CLASSES [expect-crash]
run_classes() {
  local name="$1" classes="$2" expect_crash="${3:-}"
  log "instrumentation $name"
  adb shell am instrument -w -r -e class "$classes" "$RUNNER" > "$OUT/instr-$name.txt" 2>&1
  cat "$OUT/instr-$name.txt" | grep -E "INSTRUMENTATION_STATUS: (test|stack)=|^OK|FAILURES|Tests run|shortMsg|Process crashed" | head -200
  if [ -n "$expect_crash" ]; then
    grep -q "Process crashed" "$OUT/instr-$name.txt" && return 0
    log "$name: expected the process to be killed"; FAIL=1; return 1
  fi
  if grep -q "FAILURES!!!\|INSTRUMENTATION_FAILED\|Process crashed" "$OUT/instr-$name.txt" || ! grep -q "^OK (" "$OUT/instr-$name.txt"; then
    log "$name FAILED"; FAIL=1; return 1
  fi
  log "$name PASSED"
}

run_classes A "$APP.EmulatorSmokeTest,$APP.PermissionDialogFlowTest"

run_classes B1 "$APP.ProcessDeathPhase1" expect-crash
sleep 2
if adb logcat -d | grep -q "process_death phase1 pending saved"; then log "B1 evidence present"; else log "B1 evidence missing"; FAIL=1; fi
run_classes B2 "$APP.ProcessDeathPhase2"

for scenario in scripts/emulator/scenarios/*.sh; do
  name=$(basename "$scenario" .sh)
  log "scenario $name"
  if bash "$scenario" "$API" "$OUT" > "$OUT/scenario-$name.txt" 2>&1; then
    log "scenario $name PASSED"
  else
    log "scenario $name FAILED"; FAIL=1
  fi
  cat "$OUT/scenario-$name.txt"
done

run_classes D "$APP.SpecialAccessTest,$APP.DeviceCapabilityTest,$APP.SettingsUiTest"

sleep 1
adb logcat -d > "$OUT/logcat-final.txt" 2>&1 || true
grep -h "ZARVIS_EVIDENCE" "$OUT/logcat-final.txt" "$OUT"/scenario-*.txt 2>/dev/null | sed 's/^.*ZARVIS_EVIDENCE/ZARVIS_EVIDENCE/' | sort -u > "$OUT/evidence.txt" || true
log "evidence:"; cat "$OUT/evidence.txt"
exit $FAIL
