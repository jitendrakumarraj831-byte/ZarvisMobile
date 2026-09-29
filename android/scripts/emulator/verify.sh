#!/usr/bin/env bash
# Phase 1 on-device verification driver (run inside the emulator-runner, cwd = android/).
# Installs the app + instrumentation and runs, in order:
#   A. fresh-install permission flows (real runtime dialogs)
#   B. process death while an action waits on the user (two separate processes)
#   C. adb lifecycle scenarios (revocation kills the process)
#   D. special access + device capabilities against the real system services
#   E. the Settings UI (Notifications page, Permission Center), driven like a user
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
adb logcat -G 16M || true
adb logcat -c || true
(adb logcat -v time > "$OUT/logcat.txt" 2>&1 &)
adb shell settings put system screen_off_timeout 1800000 || true
adb shell svc power stayon true || true
# No lock screen at all. On the API 26 image, every keyguard "occluded" change (e.g. from
# `wm dismiss-keyguard`, or an activity shown over the keyguard) crashes System UI with an NPE in
# StatusBar.onKeyguardOccludedChanged (null NavigationBarFragment) -- an Android 8.0 platform
# bug, see the crash stacks printed at the end. With the keyguard disabled that path never runs.
adb shell locksettings set-disabled true || adb shell cmd lock_settings set-disabled true || true
adb shell settings put secure lockscreen.disabled 1 || true
adb shell input keyevent KEYCODE_WAKEUP || true
if [ "$API" -ge 28 ]; then adb shell wm dismiss-keyguard || true; else adb shell input keyevent 82 || true; fi

log "installing"
adb install -r app/build/outputs/apk/debug/app-debug.apk || { log "install failed"; exit 1; }
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk || { log "test install failed"; exit 1; }
# Emulator GPS fix for the location check (Forbesganj, Bihar).
adb emu geo fix 87.2677 26.2987 || true

# run_classes NAME CLASSES [expect-crash]
run_classes() {
  local name="$1" classes="$2" expect_crash="${3:-}"
  log "instrumentation $name"
  # A hard limit per phase, so a hang still leaves evidence and diagnostics in the job log.
  timeout 1200 adb shell am instrument -w -r -e class "$classes" "$RUNNER" > "$OUT/instr-$name.txt" 2>&1
  if [ $? -eq 124 ]; then
    log "$name TIMED OUT after 20 min; last output:"; tail -40 "$OUT/instr-$name.txt"
    adb shell am force-stop "$APP" || true
  fi
  cat "$OUT/instr-$name.txt" | grep -E "INSTRUMENTATION_STATUS: (test|stack)=|^OK|FAILURES|Tests run|shortMsg|Process crashed|TestTimedOut|stuck thread|^\s+at com\.zarvismobile" | head -300
  if [ -n "$expect_crash" ]; then
    grep -q "Process crashed" "$OUT/instr-$name.txt" && return 0
    log "$name: expected the process to be killed"; FAIL=1; return 1
  fi
  if grep -q "FAILURES!!!\|INSTRUMENTATION_FAILED\|Process crashed" "$OUT/instr-$name.txt" || ! grep -q "^OK (" "$OUT/instr-$name.txt"; then
    log "$name FAILED"; FAIL=1; return 1
  fi
  log "$name PASSED"
}

if [ "$API" -lt 28 ]; then
  # Android 8.x image: System UI crashes (NPE in StatusBar.onKeyguardOccludedChanged, a platform
  # bug -- stacks printed at the end) the first few times an ActivityScenario launch toggles the
  # keyguard's "occluded" state; its "System UI has stopped" dialog then covers Android's
  # permission dialogs. Run the warm-up (not evidence) until System UI stops crashing.
  log "settling System UI (Android 8.x platform crash)"
  for attempt in 1 2 3 4 5; do
    before=$(adb logcat -d 2>/dev/null | grep -c "Process: com.android.systemui")
    adb shell am instrument -w -e class "$APP.SystemWarmUp" "$RUNNER" > "$OUT/instr-warmup-$attempt.txt" 2>&1
    sleep 5
    adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1
    after=$(adb logcat -d 2>/dev/null | grep -c "Process: com.android.systemui")
    log "settle attempt $attempt: System UI crashes so far $after (new during this attempt: $((after - before)))"
    [ "$after" -eq "$before" ] && break
  done
  adb shell am force-stop $APP
fi

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

# Keep feeding GPS fixes while phase D runs (a single fix goes stale before the location test).
( while true; do adb emu geo fix 87.2677 26.2987 >/dev/null 2>&1; sleep 3; done ) &
GEO_PID=$!
run_classes D "$APP.SpecialAccessTest,$APP.DeviceCapabilityTest"
# E: the Settings UI in a fresh process, independent of D's accessibility-service toggling.
run_classes E "$APP.SettingsUiTest"

kill "$GEO_PID" 2>/dev/null || true
sleep 1
adb logcat -d > "$OUT/logcat-final.txt" 2>&1 || true
cat "$OUT/logcat.txt" "$OUT/logcat-final.txt" "$OUT"/scenario-*.txt 2>/dev/null | grep -h "ZARVIS_EVIDENCE" 2>/dev/null | sed 's/^.*ZARVIS_EVIDENCE/ZARVIS_EVIDENCE/' | sort -u > "$OUT/evidence.txt" || true
log "evidence:"; cat "$OUT/evidence.txt"
# What was on screen whenever a wait timed out or a test failed.
cat "$OUT/logcat.txt" "$OUT/logcat-final.txt" 2>/dev/null | grep -h "ZARVIS_DIAG" | sed 's/^.*ZARVIS_DIAG/ZARVIS_DIAG/' | cut -c1-1500 | awk "!seen[\$0]++" > "$OUT/diagnostics.txt" || true
log "diagnostics:"; cat "$OUT/diagnostics.txt"
# Crashes of other processes during the run (e.g. System UI), with their stacks: tells whether
# anything ZARVIS did appears in them.
log "crashes during the run:"
cat "$OUT/logcat.txt" "$OUT/logcat-final.txt" 2>/dev/null | grep -A 25 "FATAL EXCEPTION" | grep -v "^--$" | awk '!seen[$0]++' | cut -c1-300 | head -120
exit $FAIL
