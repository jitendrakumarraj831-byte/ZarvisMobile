#!/usr/bin/env bash
# Phase 1 on-device verification driver (run inside the emulator-runner, cwd = android/).
# Also runs on a physical phone through scripts/device/verify-device.sh, which sets
# ZARVIS_PHYSICAL_DEVICE=1: then nothing emulator-only (lock-screen changes, `adb emu`) is run.
# Installs the app + instrumentation and runs, in order:
#   A. fresh-install permission flows (real runtime dialogs)
#   B. process death while an action waits on the user (two separate processes)
#   C. adb lifecycle scenarios (revocation kills the process)
#   D. special access + device capabilities against the real system services
#   E. the Settings UI (Notifications page, Permission Center), driven like a user
# All output goes to build/emulator-evidence/; exits non-zero on any failure.
#
# Every step is time-bounded. A lost emulator is reported as an infrastructure failure, never as
# a ZARVIS result and never as a pass: `adb logcat` and `adb wait-for-device` wait for a device
# without any limit, so one emulator that vanished mid-run used to hang the job until it was
# cancelled (API 26, 2026-10-03: no output for 51 minutes after phase D lost the device).
# Exit codes: 0 all passed, 1 a test failed, 3 the emulator/adb connection was lost.
set -uo pipefail
# Git Bash on Windows (physical-device runs): keep "/sdcard/…" arguments as they are.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

API="${1:?api level}"
OUT="build/emulator-evidence"
mkdir -p "$OUT"
APP=com.zarvismobile.app
RUNNER="$APP.test/androidx.test.runner.AndroidJUnitRunner"
FAIL=0
DEVICE="${ZARVIS_PHYSICAL_DEVICE:-0}"
# Extra instrumentation arguments, e.g. "-e callNumber <a number you own>" on a physical phone.
INSTR_ARGS="${ZARVIS_INSTR_ARGS:-}"
KIND=$([ "$DEVICE" = 1 ] && echo device || echo api)
log() { echo "[verify $KIND$API] $*"; }

# Bounded adb. Plain `adb` in this script and in the scenario scripts goes through this
# function: no single call can block for more than ADB_TIMEOUT seconds (`timeout` itself runs
# the real binary, so the explicit `timeout N adb ...` instrumentation calls keep their own
# longer limits). The background logcat stream uses "$ADB_BIN" directly.
ADB_BIN="$(command -v adb)"
ADB_TIMEOUT="${ZARVIS_ADB_TIMEOUT:-90}"
PHASE_TIMEOUT="${ZARVIS_PHASE_TIMEOUT:-600}"
RECOVER_TIMEOUT="${ZARVIS_RECOVER_TIMEOUT:-90}"
adb() { timeout "$ADB_TIMEOUT" "$ADB_BIN" "$@"; }
export -f adb
export ADB_BIN ADB_TIMEOUT

# The device is usable: adb sees it and a shell command answers.
device_alive() {
  [ "$(timeout 10 "$ADB_BIN" get-state 2>/dev/null | tr -d '\r')" = device ] &&
    timeout 15 "$ADB_BIN" shell echo zarvis-alive 2>/dev/null | grep -q zarvis-alive
}
systemui_crashes() { adb logcat -d 2>/dev/null | grep -c "Process: com.android.systemui"; }

# What was on screen and running when a phase failed (device side), or what happened to the
# emulator when it vanished (host side). Bounded; best effort; saved under $OUT/diag-<name>/.
capture_diag() {
  local name="$1" dir="$OUT/diag-$1"
  mkdir -p "$dir"
  if device_alive; then
    adb logcat -d > "$dir/logcat.txt" 2>&1
    adb shell dumpsys window windows 2>/dev/null | grep -E "mCurrentFocus|mFocusedApp" > "$dir/focus.txt"
    adb shell dumpsys activity activities 2>/dev/null | grep -E "mResumedActivity|mFocusedActivity" > "$dir/activities.txt"
    adb shell dumpsys activity processes com.android.systemui 2>/dev/null | grep -E "ProcessRecord|pid=|crashing|notResponding" | head -20 > "$dir/systemui.txt"
    adb shell ps -A 2>/dev/null | grep -E "systemui|zarvis" > "$dir/ps.txt"
    adb shell getprop sys.boot_completed > "$dir/boot_completed.txt" 2>&1
    log "diagnostics for $name: focus: $(tr '\n' ' ' < "$dir/focus.txt" | cut -c1-300)"
    log "diagnostics for $name: System UI: $(tr '\n' ' ' < "$dir/systemui.txt" | cut -c1-300)"
    grep -A 12 "FATAL EXCEPTION" "$dir/logcat.txt" | grep -v "^--$" | cut -c1-240 | head -40
  else
    { timeout 10 "$ADB_BIN" devices -l; echo; ps -eo pid,etime,rss,args | grep -E "[q]emu-system|[e]mulator .*-avd"; echo "emulator processes listed above (none = the emulator process is gone)"; echo; free -m; } > "$dir/host.txt" 2>&1
    log "diagnostics for $name: device unreachable; host state:"; sed 's/^/  /' "$dir/host.txt" | cut -c1-240 | head -20
  fi
}

# The emulator disappeared (adb lost it, or the emulator process died). One bounded attempt to
# get it back; the interrupted phase is then re-run once and reported as such.
EMULATOR_LOST=""
RECOVERIES=0
recover_device() {
  local phase="$1"
  log "EMULATOR LOST during $phase: adb can no longer reach the device (infrastructure failure, not a ZARVIS result)"
  capture_diag "lost-$phase"
  if [ "$RECOVERIES" -lt 1 ] && [ "$DEVICE" != 1 ]; then
    RECOVERIES=$((RECOVERIES + 1))
    log "reconnecting to the emulator (one attempt, ${RECOVER_TIMEOUT} s)"
    timeout 10 "$ADB_BIN" reconnect >/dev/null 2>&1
    if timeout "$RECOVER_TIMEOUT" "$ADB_BIN" wait-for-device 2>/dev/null && device_alive &&
       [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then
      log "emulator reachable again"
      echo "ZARVIS_EVIDENCE sdk=$API emulator_reconnected phase=$phase (adb lost the device once; the phase was re-run once)" >> "$OUT/infra-notes.txt"
      return 0
    fi
  fi
  EMULATOR_LOST="$phase"
  echo "ZARVIS_EVIDENCE sdk=$API emulator_lost phase=$phase (infrastructure failure; later phases NOT RUN)" >> "$OUT/platform-blocked.txt"
  return 1
}

timeout 120 "$ADB_BIN" wait-for-device || { log "no device after 120 s"; capture_diag startup; exit 3; }
adb shell getprop ro.build.version.sdk | tee "$OUT/sdk.txt"
adb logcat -G 16M || true
adb logcat -c || true
"$ADB_BIN" logcat -v time > "$OUT/logcat.txt" 2>&1 &
LOGCAT_PID=$!
trap 'kill "$LOGCAT_PID" 2>/dev/null' EXIT
adb shell settings put system screen_off_timeout 1800000 || true
adb shell svc power stayon true || true
# No lock screen at all. On the API 26 image, every keyguard "occluded" change (e.g. from
# `wm dismiss-keyguard`, or an activity shown over the keyguard) crashes System UI with an NPE in
# StatusBar.onKeyguardOccludedChanged (null NavigationBarFragment) -- an Android 8.0 platform
# bug, see the crash stacks printed at the end. With the keyguard disabled that path never runs.
# Never on a physical phone: its owner's lock screen is left exactly as it is (the device driver
# asks for the phone to be unlocked instead).
if [ "$DEVICE" != 1 ]; then
  adb shell locksettings set-disabled true || adb shell cmd lock_settings set-disabled true || true
  adb shell settings put secure lockscreen.disabled 1 || true
fi
adb shell input keyevent KEYCODE_WAKEUP || true
if [ "$DEVICE" != 1 ]; then
  if [ "$API" -ge 28 ]; then adb shell wm dismiss-keyguard || true; else adb shell input keyevent 82 || true; fi
fi

log "installing"
timeout 300 "$ADB_BIN" install -r app/build/outputs/apk/debug/app-debug.apk || { log "install failed"; capture_diag install; exit 1; }
timeout 300 "$ADB_BIN" install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk || { log "test install failed"; capture_diag install; exit 1; }
# Emulator GPS fix for the location check (Forbesganj, Bihar). A phone uses its real location.
[ "$DEVICE" = 1 ] || adb emu geo fix 87.2677 26.2987 || true

# instrument NAME ARGS...: one bounded `am instrument` run into $OUT/instr-NAME.txt. Returns 124
# on timeout, 75 when the emulator was lost (and could not be recovered), else 0.
instrument() {
  local name="$1"; shift
  local crashes_before; crashes_before=$(systemui_crashes)
  [ -n "${ZARVIS_FAULT:-}" ] && [ "${ZARVIS_FAULT#emulator-loss:}" = "$name" ] && inject_emulator_loss
  timeout "$PHASE_TIMEOUT" "$ADB_BIN" shell am instrument -w -r $INSTR_ARGS "$@" "$RUNNER" > "$OUT/instr-$name.txt" 2>&1
  local rc=$?
  # A finished run always ends with INSTRUMENTATION_CODE; without it the run was cut off.
  if [ $rc -eq 124 ]; then
    log "$name TIMED OUT after $PHASE_TIMEOUT s; last output:"; tail -40 "$OUT/instr-$name.txt"
    if device_alive; then capture_diag "$name"; adb shell am force-stop "$APP"; return 124; fi
  elif grep -q "INSTRUMENTATION_CODE" "$OUT/instr-$name.txt" || device_alive; then
    local crashes_after; crashes_after=$(systemui_crashes)
    [ "$crashes_after" -gt "$crashes_before" ] && log "$name: System UI crashed $((crashes_after - crashes_before)) time(s) during this phase (Android platform process, not ZARVIS)"
    return 0
  fi
  log "$name: instrumentation output ended without a result: $(tail -3 "$OUT/instr-$name.txt" | tr '\n' ' ' | cut -c1-200)"
  recover_device "$name" && return 76
  return 75
}

# run_classes NAME CLASSES [expect-crash]
run_classes() {
  local name="$1" classes="$2" expect_crash="${3:-}"
  if [ -n "$EMULATOR_LOST" ]; then log "$name NOT RUN (emulator lost during $EMULATOR_LOST)"; return 1; fi
  log "instrumentation $name"
  instrument "$name" -e class "$classes"
  local rc=$?
  if [ $rc -eq 76 ]; then
    log "$name: re-running once after the emulator connection was lost"
    instrument "$name" -e class "$classes"; rc=$?
    [ $rc -eq 76 ] && rc=75
  fi
  cat "$OUT/instr-$name.txt" | grep -E "INSTRUMENTATION_STATUS: (test|stack)=|^OK|FAILURES|Tests run|shortMsg|Process crashed|TestTimedOut|stuck thread|^\s+at com\.zarvismobile" | head -300
  if [ $rc -eq 75 ]; then log "$name EMULATOR LOST (infrastructure failure, not counted as passed or failed)"; return 1; fi
  if [ $rc -eq 124 ]; then log "$name FAILED (timed out)"; FAIL=1; return 1; fi
  if [ -n "$expect_crash" ]; then
    grep -q "Process crashed" "$OUT/instr-$name.txt" && return 0
    log "$name: expected the process to be killed"; FAIL=1; return 1
  fi
  if grep -q "FAILURES!!!\|INSTRUMENTATION_FAILED\|Process crashed" "$OUT/instr-$name.txt" || ! grep -q "^OK (" "$OUT/instr-$name.txt"; then
    if grep -q "Process crashed" "$OUT/instr-$name.txt"; then log "$name FAILED (the ZARVIS test process crashed)"; else log "$name FAILED"; fi
    capture_diag "$name"
    FAIL=1; return 1
  fi
  log "$name PASSED"
}

# Self-test of this harness only (workflow job "harness-selftest", never the real matrix):
# ZARVIS_FAULT=emulator-loss:<phase> kills the emulator 40 s into that phase, the failure that
# used to hang the job.
inject_emulator_loss() {
  log "FAULT INJECTION: killing the emulator 40 s into this phase (harness self-test)"
  ( sleep 40; timeout 10 "$ADB_BIN" emu kill >/dev/null 2>&1 ) &
}

if [ "$API" -lt 28 ]; then
  # Android 8.x image: System UI crashes (NPE in StatusBar.onKeyguardOccludedChanged via
  # KeyguardViewMediator.handleSetOccluded, a platform bug -- stacks printed at the end) when
  # Android shows its permission dialog; the "System UI has stopped" dialog then covers it.
  # Run the warm-up (not evidence) until System UI stops crashing, if it ever does.
  log "settling System UI (Android 8.x platform crash)"
  # Bounded: 3 attempts of at most 5 minutes each. Five attempts never settled it in any run
  # (2026-10-03: 25 and 26 System UI crashes, 4-5 in every attempt, dialog shown 0 times).
  for attempt in 1 2 3; do
    before=$(systemui_crashes)
    timeout 300 "$ADB_BIN" shell am instrument -w -e class "$APP.SystemWarmUp" "$RUNNER" > "$OUT/instr-warmup-$attempt.txt" 2>&1
    [ $? -eq 124 ] && log "settle attempt $attempt timed out after 300 s"
    if ! device_alive; then recover_device "warm-up" || break; fi
    sleep 5
    adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1
    after=$(systemui_crashes)
    log "settle attempt $attempt: System UI crashes so far $after (new during this attempt: $((after - before)))"
    [ "$after" -eq "$before" ] && break
    adb logcat -d 2>/dev/null | grep -q "permission dialog shown=true" && break
  done
  adb shell am force-stop $APP
  [ "$after" -gt 0 ] 2>/dev/null && capture_diag warm-up
fi

# Did Android's runtime-permission dialog ever appear during the warm-up, and does System UI
# still crash? If it never appeared and System UI kept crashing on every attempt, the dialog
# cannot be shown on this image at all (Android 8.x platform bug, stacks printed at the end).
DIALOG_BLOCKED=0
if [ "$API" -lt 28 ]; then
  shown=$(adb logcat -d 2>/dev/null | grep -c "permission dialog shown=true")
  crashes=$(adb logcat -d 2>/dev/null | grep -c "Process: com.android.systemui")
  log "warm-up: Android permission dialog seen $shown time(s); System UI crashes $crashes"
  if [ "$shown" -eq 0 ] && [ "$crashes" -gt 0 ]; then DIALOG_BLOCKED=1; fi
fi

if [ "$DIALOG_BLOCKED" -eq 1 ]; then
  # Everything that does not need Android's own dialog must still pass.
  run_classes A "$APP.EmulatorSmokeTest,$APP.PermissionDialogFlowTest#a_notNowShowsNoSystemDialogAndChangesNothing,$APP.PermissionDialogFlowTest#e_notificationsFollowTheAndroidVersion"
  # The tests that need Android's dialog still run, but on this image they cannot pass and are
  # reported as blocked by the platform -- never as passed.
  log "instrumentation A-dialog (Android's permission dialog cannot be displayed on this image)"
  [ -z "$EMULATOR_LOST" ] && instrument A-dialog -e class "$APP.PermissionDialogFlowTest#b_learnMoreThenDenyInTheRealDialogIsVerifiedDenied,$APP.PermissionDialogFlowTest#c_allowInTheRealDialogIsVerifiedGranted,$APP.PermissionDialogFlowTest#d_permanentDenialLeadsToSettingsAndStaysDenied,$APP.PermissionDialogFlowTest#f_microphoneDeniedKeepsTextInput"
  grep -E "INSTRUMENTATION_STATUS: test=|^OK|Tests run|FAILURES" "$OUT/instr-A-dialog.txt" | head -40
  if [ -n "$EMULATOR_LOST" ]; then
    log "A-dialog NOT RUN or cut off (emulator lost during $EMULATOR_LOST); not a platform-blocked result"
  elif grep -q "^OK (" "$OUT/instr-A-dialog.txt"; then
    log "A-dialog PASSED (the dialog was displayed after all)"
  else
    log "A-dialog PLATFORM-BLOCKED: runtime-permission dialog flow UNVERIFIED on API $API (System UI crashes whenever Android shows the dialog); not counted as a pass"
    echo "ZARVIS_EVIDENCE sdk=$API permission_dialog_flow UNVERIFIED platform-blocked (System UI NPE in StatusBar.onKeyguardOccludedChanged each time Android shows GrantPermissionsActivity)" >> "$OUT/platform-blocked.txt"
  fi
else
  run_classes A "$APP.EmulatorSmokeTest,$APP.PermissionDialogFlowTest"
fi

run_classes B1 "$APP.ProcessDeathPhase1" expect-crash
sleep 2
if [ -z "$EMULATOR_LOST" ]; then
  if adb logcat -d | grep -q "process_death phase1 pending saved"; then log "B1 evidence present"; else log "B1 evidence missing"; FAIL=1; fi
fi
run_classes B2 "$APP.ProcessDeathPhase2"

for scenario in scripts/emulator/scenarios/*.sh; do
  name=$(basename "$scenario" .sh)
  if [ -n "$EMULATOR_LOST" ]; then log "scenario $name NOT RUN (emulator lost during $EMULATOR_LOST)"; continue; fi
  log "scenario $name"
  if timeout "$PHASE_TIMEOUT" bash "$scenario" "$API" "$OUT" > "$OUT/scenario-$name.txt" 2>&1; then
    log "scenario $name PASSED"
  elif ! device_alive; then
    recover_device "scenario-$name" || true
    log "scenario $name EMULATOR LOST (infrastructure failure, not counted as passed or failed)"
  else
    log "scenario $name FAILED"; capture_diag "scenario-$name"; FAIL=1
  fi
  cat "$OUT/scenario-$name.txt"
done

# Keep feeding GPS fixes while phase D runs (a single fix goes stale before the location test).
GEO_PID=""
if [ "$DEVICE" != 1 ]; then
  ( while true; do adb emu geo fix 87.2677 26.2987 >/dev/null 2>&1; sleep 3; done ) &
  GEO_PID=$!
fi
run_classes D "$APP.SpecialAccessTest,$APP.DeviceCapabilityTest"
# E: the Settings UI in a fresh process, independent of D's accessibility-service toggling.
run_classes E "$APP.SettingsUiTest"
# F: one user turn = one execution across Activity recreation, rotation and background.
run_classes F "$APP.ConversationLifecycleTest"

[ -n "$GEO_PID" ] && kill "$GEO_PID" 2>/dev/null || true
sleep 1
if [ -z "$EMULATOR_LOST" ]; then adb logcat -d > "$OUT/logcat-final.txt" 2>&1 || true; fi
cat "$OUT/logcat.txt" "$OUT/logcat-final.txt" "$OUT"/scenario-*.txt "$OUT/platform-blocked.txt" "$OUT/infra-notes.txt" 2>/dev/null | grep -h "ZARVIS_EVIDENCE" 2>/dev/null | sed 's/^.*ZARVIS_EVIDENCE/ZARVIS_EVIDENCE/' | sort -u > "$OUT/evidence.txt" || true
log "evidence:"; cat "$OUT/evidence.txt"
# What was on screen whenever a wait timed out or a test failed.
cat "$OUT/logcat.txt" "$OUT/logcat-final.txt" 2>/dev/null | grep -h "ZARVIS_DIAG" | sed 's/^.*ZARVIS_DIAG/ZARVIS_DIAG/' | cut -c1-1500 | awk "!seen[\$0]++" > "$OUT/diagnostics.txt" || true
log "diagnostics:"; cat "$OUT/diagnostics.txt"
# Crashes of other processes during the run (e.g. System UI), with their stacks: tells whether
# anything ZARVIS did appears in them.
# Why ZARVIS left the foreground whenever it did: ActivityManager's own records of its
# activities and process (starts, deaths, kills, ANRs), from the full-run logcat.
log "ZARVIS lifecycle (ActivityManager):"
cat "$OUT/logcat.txt" 2>/dev/null | grep -E "ActivityManager|ActivityTaskManager|WindowManager" | grep -iE "zarvis" \
  | grep -iE "kill|died|death|anr|crash|force|finish|START u0|Displayed|pause|Moving" | cut -c1-260 | tail -80
# Main-thread health of the debug build (StrictMode is on in ZarvisApplication): no network on
# the UI thread and no ANR during the whole run.
# A violation counts only if it is a network violation whose stack runs through ZARVIS code.
STRICT=$(cat "$OUT/logcat.txt" "$OUT/logcat-final.txt" 2>/dev/null | awk '
  /StrictMode policy violation/ { if (blk) n += (net && ours); blk = 1; net = 0; ours = 0; lines = 0 }
  blk { lines++; if ($0 ~ /NetworkViolation|NetworkOnMainThread/) net = 1; if ($0 ~ /com\.zarvismobile/) ours = 1; if (lines > 40) { n += (net && ours); blk = 0 } }
  END { if (blk) n += (net && ours); print n + 0 }')
ANRS=$(cat "$OUT/logcat.txt" "$OUT/logcat-final.txt" 2>/dev/null | grep -c "ANR in $APP" || true)
log "main thread: StrictMode network violations=$STRICT, ANRs=$ANRS"
if [ "$STRICT" != "0" ] || [ "$ANRS" != "0" ]; then
  cat "$OUT/logcat.txt" "$OUT/logcat-final.txt" 2>/dev/null | grep -A12 "StrictMode policy violation\|ANR in $APP" | head -80
  FAIL=1
fi
log "crashes during the run:"
cat "$OUT/logcat.txt" "$OUT/logcat-final.txt" 2>/dev/null | grep -A 25 "FATAL EXCEPTION" | grep -v "^--$" | awk '!seen[$0]++' | cut -c1-300 | head -120
if [ -n "$EMULATOR_LOST" ]; then
  log "RESULT: INFRASTRUCTURE FAILURE: the emulator was lost during $EMULATOR_LOST; every later phase is NOT RUN. Nothing after that point is reported as passed."
  exit 3
fi
if [ "$FAIL" -ne 0 ]; then
  log "RESULT: FAILED (see the phases above)"
elif [ -s "$OUT/platform-blocked.txt" ]; then
  log "RESULT: every runnable phase passed; NOT counted as passed:"; sed 's/^/  /' "$OUT/platform-blocked.txt"
else
  log "RESULT: all phases passed"
fi
[ -s "$OUT/infra-notes.txt" ] && { log "infrastructure notes:"; sed 's/^/  /' "$OUT/infra-notes.txt"; }
exit $FAIL
