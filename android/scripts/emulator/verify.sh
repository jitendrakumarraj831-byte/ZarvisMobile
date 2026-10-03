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
#   F. one user turn = one execution across Activity recreation, rotation and background
# All output goes to build/emulator-evidence/. Each phase is reported as PASSED, FAILED (a ZARVIS
# test result), TIMED OUT (the phase exceeded its limit), PLATFORM-BLOCKED (API 26 permission
# dialog, only with System UI crash evidence from that run), EMULATOR LOST (the emulator/adb
# stopped responding: an infrastructure failure, never a ZARVIS result and never a pass) or
# NOT RUN; nothing can wait without a time limit.
# Exit codes: 0 every runnable phase passed, 1 a ZARVIS test failed or timed out (or the run was
# incomplete), 3 the emulator was lost and no ZARVIS test failed before that.
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

# Nothing here may wait forever. `adb logcat` (unlike `adb shell`) silently waits for a device
# when there is none, so once the emulator is gone a bare `adb logcat -d` never returns: that is
# how one API 26 run sat for 50 minutes after its emulator died during phase D. Every adb call
# that can block is therefore bounded, the device is checked after each phase, and the whole run
# has a time budget (the workflow step has a hard limit above it).
adbt() { local secs="$1"; shift; timeout -k 5 "$secs" "$ADB_BIN" "$@"; }
# Plain `adb ...` below (and in the scenario scripts) goes through this function, so even a call
# not written with adbt cannot block for more than ADB_TIMEOUT seconds. `timeout` runs the real
# binary, so the explicit `timeout N adb ...` instrumentation calls keep their own limits. The
# background logcat stream uses "$ADB_BIN" directly (it must outlive any single limit).
ADB_BIN="$(command -v adb)"
ADB_TIMEOUT="${ZARVIS_ADB_TIMEOUT:-90}"
adb() { timeout -k 5 "$ADB_TIMEOUT" "$ADB_BIN" "$@"; }
export -f adb
export ADB_BIN ADB_TIMEOUT
# Usable device: adb lists it AND a shell command answers (a wedged emulator can still report
# "device" while every shell command hangs).
device_ok() {
  [ "$(timeout -k 2 10 "$ADB_BIN" get-state 2>/dev/null | tr -d '\r')" = device ] &&
    timeout -k 2 15 "$ADB_BIN" shell echo zarvis-alive 2>/dev/null | tr -d '\r' | grep -qx zarvis-alive
}
RECOVER_TIMEOUT="${ZARVIS_RECOVER_TIMEOUT:-90}"
RECOVERIES=0
# One bounded attempt to get a lost emulator back (never on a physical phone). Returns 0 if it
# answers again; the caller then re-runs the interrupted phase once and records that it did.
recover_device() {
  [ "$DEVICE" = 1 ] && return 1
  [ "$RECOVERIES" -ge 1 ] && return 1
  RECOVERIES=$((RECOVERIES + 1))
  log "the emulator stopped answering; reconnecting (one attempt, ${RECOVER_TIMEOUT}s)"
  timeout -k 2 10 "$ADB_BIN" reconnect >/dev/null 2>&1
  timeout -k 5 "$RECOVER_TIMEOUT" "$ADB_BIN" wait-for-device >/dev/null 2>&1 || return 1
  device_ok || return 1
  [ "$(adbt 20 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] || return 1
  log "the emulator answers again"
  return 0
}
# System UI crashes seen so far, from the logcat stream on disk (no adb call needed).
sui_crashes() { local n; n=$(grep -c "Process: com.android.systemui" "$OUT/logcat.txt" 2>/dev/null); echo "${n:-0}"; }
BUDGET="${ZARVIS_VERIFY_BUDGET_SECONDS:-2400}"
PHASE_MAX="${ZARVIS_PHASE_MAX_SECONDS:-1200}"
DEVICE_LOST=""
APP_FAILED=0
RESULTS=()
record() { RESULTS+=("$1: $2"); }
# Seconds the next phase may take: at most PHASE_MAX, and always leaving time for the report.
phase_limit() {
  local left=$((BUDGET - SECONDS - 180))
  [ "$left" -lt 60 ] && return 1
  [ "$left" -gt "$PHASE_MAX" ] && left=$PHASE_MAX
  echo "$left"
}
# The device stopped answering: an emulator/adb failure, not a ZARVIS result. Record what the
# runner can still see (the logcat stream captured until the loss is kept in $OUT/logcat.txt).
infra_diagnostics() {
  local name="$1"
  log "$name EMULATOR LOST: the device stopped responding (emulator/adb failure, not a ZARVIS test result); diagnostics:"
  { echo "## adb devices -l"; timeout -k 2 10 "$ADB_BIN" devices -l
    echo "## emulator processes on the runner"; ps -eo pid,etime,rss,args | grep -E "qemu-system|emulator.* -avd " | grep -v grep | cut -c1-220; echo "(no line above = the emulator process is gone)"
    echo "## runner memory"; free -m
    echo "## last instrumentation output"; tail -40 "$OUT/instr-$name.txt" 2>/dev/null
    echo "## crashes in the logcat captured before the loss"; grep -A6 "FATAL EXCEPTION\|Fatal signal\|ANR in" "$OUT/logcat.txt" 2>/dev/null | tail -60
    echo "## last logcat lines before the loss"; tail -80 "$OUT/logcat.txt" 2>/dev/null
  } > "$OUT/infra-$name.txt" 2>&1
  cut -c1-300 "$OUT/infra-$name.txt"
}
# A phase failed while the device was still up: what was in front, and is System UI alive?
phase_diagnostics() {
  local name="$1"
  { echo "## focused window"; adbt 20 shell dumpsys window windows | grep -E "mCurrentFocus|mFocusedApp" | head -5
    echo "## resumed activity"; adbt 20 shell dumpsys activity activities | grep -E "mResumedActivity|mFocusedActivity" | head -5
    echo "## System UI pid"; adbt 10 shell pidof com.android.systemui
    echo "## System UI process record"; adbt 20 shell dumpsys activity processes com.android.systemui | grep -E "ProcessRecord|crashing|notResponding" | head -5
    echo "## boot completed"; adbt 10 shell getprop sys.boot_completed
    echo "## System UI crashes so far"; grep -c "Process: com.android.systemui" "$OUT/logcat.txt" 2>/dev/null
  } > "$OUT/diag-$name.txt" 2>&1
  log "$name diagnostics:"; cut -c1-300 "$OUT/diag-$name.txt"
}

BOOT_WAIT="${ZARVIS_DEVICE_WAIT_SECONDS:-300}"
timeout -k 5 "$BOOT_WAIT" "$ADB_BIN" wait-for-device || { log "EMULATOR LOST: no device after ${BOOT_WAIT}s (infrastructure failure, nothing was run)"; infra_diagnostics startup; exit 3; }
# Listed is not enough: a wedged emulator is listed while every shell command hangs. Catch that
# here, before the setup commands below would each wait out their own limit.
if ! device_ok && ! recover_device; then
  log "EMULATOR LOST: the device is listed but does not answer shell commands (infrastructure failure, nothing was run)"
  infra_diagnostics startup; exit 3
fi
adbt 30 shell getprop ro.build.version.sdk | tee "$OUT/sdk.txt"
adbt 30 logcat -G 16M || true
adbt 30 logcat -c || true
"$ADB_BIN" logcat -v time > "$OUT/logcat.txt" 2>&1 &
LOGCAT_PID=$!
GEO_PID=""
trap 'kill "$LOGCAT_PID" 2>/dev/null; [ -n "$GEO_PID" ] && kill "$GEO_PID" 2>/dev/null' EXIT
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
adbt 300 install -r app/build/outputs/apk/debug/app-debug.apk || { log "install failed"; device_ok || { infra_diagnostics install; exit 3; }; exit 1; }
adbt 300 install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk || { log "test install failed"; device_ok || { infra_diagnostics install; exit 3; }; exit 1; }
# Emulator GPS fix for the location check (Forbesganj, Bihar). A phone uses its real location.
[ "$DEVICE" = 1 ] || adb emu geo fix 87.2677 26.2987 || true

# run_classes NAME CLASSES [expect-crash]
run_classes() {
  local name="$1" classes="$2" expect_crash="${3:-}" limit rc attempt=1 note="" sui_before sui_new
  if [ -n "$DEVICE_LOST" ]; then
    log "$name NOT RUN: the device was lost during $DEVICE_LOST"; record "$name" "NOT RUN (emulator lost earlier)"; FAIL=1; return 1
  fi
  while true; do
    if ! limit=$(phase_limit); then
      log "$name NOT RUN: the ${BUDGET}s time budget is used up"; record "$name" "NOT RUN (time budget)"; FAIL=1; return 1
    fi
    log "instrumentation $name${note:+ ($note)}"
    sui_before=$(sui_crashes)
    [ "${ZARVIS_FAULT_INJECT:-}" = "device-loss-during-$name" ] && [ "$DEVICE" != 1 ] && inject_device_loss_during "$name"
    # A hard limit per phase, so a hang still leaves evidence and diagnostics in the job log.
    timeout -k 10 "$limit" adb shell am instrument -w -r $INSTR_ARGS -e class "$classes" "$RUNNER" > "$OUT/instr-$name.txt" 2>&1
    rc=$?
    grep -E "INSTRUMENTATION_STATUS: (test|stack)=|^OK|FAILURES|Tests run|shortMsg|Process crashed|TestTimedOut|stuck thread|^\s+at com\.zarvismobile" "$OUT/instr-$name.txt" | head -300
    if device_ok; then break; fi
    # The device is gone. One bounded reconnect; if it comes back, re-run this phase once.
    if [ "$attempt" -eq 1 ] && recover_device; then
      attempt=2; note="re-run once after the emulator was lost and reconnected"
      echo "ZARVIS_EVIDENCE sdk=$API emulator_reconnected phase=$name (adb lost the device once; the phase was re-run once)" >> "$OUT/infra-notes.txt"
      continue
    fi
    DEVICE_LOST="$name"; infra_diagnostics "$name"
    echo "ZARVIS_EVIDENCE sdk=$API emulator_lost phase=$name (infrastructure failure; later phases NOT RUN)" >> "$OUT/infra-notes.txt"
    log "$name EMULATOR LOST (infrastructure failure, not a ZARVIS result and not a pass)"
    record "$name" "EMULATOR LOST (infrastructure failure; no ZARVIS result)"; FAIL=1; return 1
  done
  sui_new=$(( $(sui_crashes) - sui_before ))
  [ "$sui_new" -gt 0 ] && log "$name: System UI crashed $sui_new time(s) during this phase (Android platform process, not ZARVIS)"
  # Extra facts shown next to the phase result, e.g. "(re-run once ..., systemui_crashes=3)".
  [ "$sui_new" -gt 0 ] && note="${note:+$note, }systemui_crashes=$sui_new"
  local extra="${note:+ ($note)}"
  if [ $rc -eq 124 ] || [ $rc -eq 137 ]; then
    log "$name TIMED OUT after ${limit}s; last output:"; tail -40 "$OUT/instr-$name.txt"
    phase_diagnostics "$name"
    adbt 20 shell am force-stop "$APP" || true
    record "$name" "TIMED OUT after ${limit}s${extra}"; APP_FAILED=1; FAIL=1; return 1
  fi
  if [ -n "$expect_crash" ]; then
    if grep -q "Process crashed" "$OUT/instr-$name.txt"; then record "$name" "PASSED (process killed as expected${note:+, $note})"; return 0; fi
    log "$name: expected the process to be killed"; phase_diagnostics "$name"; record "$name" "FAILED${extra}"; APP_FAILED=1; FAIL=1; return 1
  fi
  if grep -q "FAILURES!!!\|INSTRUMENTATION_FAILED\|Process crashed" "$OUT/instr-$name.txt" || ! grep -q "^OK (" "$OUT/instr-$name.txt"; then
    if grep -q "Process crashed" "$OUT/instr-$name.txt"; then log "$name FAILED (the ZARVIS test process crashed)"; else log "$name FAILED"; fi
    phase_diagnostics "$name"; record "$name" "FAILED${extra}"; APP_FAILED=1; FAIL=1; return 1
  fi
  log "$name PASSED"; record "$name" "PASSED${extra}"
}
# Harness self-test only (workflow matrix entry "harness-selftest"): kills the emulator 40 s into
# the named phase, the failure that once hung this job for 51 minutes with no output.
inject_device_loss_during() {
  log "FAULT INJECTION: killing the emulator 40 s into phase $1 (harness self-test)"
  ( sleep 40; timeout -k 2 10 "$ADB_BIN" emu kill >/dev/null 2>&1 ) &
  FAIL=1
}

if [ "$API" -lt 28 ]; then
  # Android 8.x image: System UI crashes (NPE in StatusBar.onKeyguardOccludedChanged via
  # KeyguardViewMediator.handleSetOccluded, a platform bug -- stacks printed at the end) when
  # Android shows its permission dialog; the "System UI has stopped" dialog then covers it.
  # Run the warm-up (not evidence) until System UI stops crashing, if it ever does.
  log "settling System UI (Android 8.x platform crash)"
  # Bounded: at most 3 attempts of at most 5 minutes each. Five attempts never settled it in any
  # run (2026-10-02/03: 25-26 System UI crashes, 4-5 in every attempt, dialog shown 0 times).
  for attempt in 1 2 3; do
    before=$(adbt 60 logcat -d 2>/dev/null | grep -c "Process: com.android.systemui")
    timeout -k 10 300 adb shell am instrument -w -e class "$APP.SystemWarmUp" "$RUNNER" > "$OUT/instr-warmup-$attempt.txt" 2>&1
    sleep 5
    adbt 20 shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1
    after=$(adbt 60 logcat -d 2>/dev/null | grep -c "Process: com.android.systemui")
    log "settle attempt $attempt: System UI crashes so far $after (new during this attempt: $((after - before)))"
    if ! device_ok && ! recover_device; then DEVICE_LOST="warm-up"; infra_diagnostics "warmup-$attempt"; record "warm-up" "EMULATOR LOST (infrastructure failure; no ZARVIS result)"; break; fi
    [ "$after" -eq "$before" ] && break
    wlog=$(adbt 60 logcat -d 2>/dev/null)
    grep -q "permission dialog shown=true" <<< "$wlog" && break
  done
  adbt 20 shell am force-stop $APP
fi

# Did Android's runtime-permission dialog ever appear during the warm-up, and does System UI
# still crash? If it never appeared and System UI kept crashing on every attempt, the dialog
# cannot be shown on this image at all (Android 8.x platform bug, stacks printed at the end).
DIALOG_BLOCKED=0
if [ "$API" -lt 28 ]; then
  shown=$(adbt 60 logcat -d 2>/dev/null | grep -c "permission dialog shown=true")
  crashes=$(adbt 60 logcat -d 2>/dev/null | grep -c "Process: com.android.systemui")
  log "warm-up: Android permission dialog seen $shown time(s); System UI crashes $crashes"
  if [ "$shown" -eq 0 ] && [ "$crashes" -gt 0 ]; then DIALOG_BLOCKED=1; fi
fi

if [ "$DIALOG_BLOCKED" -eq 1 ]; then
  # Everything that does not need Android's own dialog must still pass.
  run_classes A "$APP.EmulatorSmokeTest,$APP.PermissionDialogFlowTest#a_notNowShowsNoSystemDialogAndChangesNothing,$APP.PermissionDialogFlowTest#e_notificationsFollowTheAndroidVersion"
  # The tests that need Android's dialog still run, but on this image they cannot pass and are
  # reported as blocked by the platform -- never as passed.
  log "instrumentation A-dialog (Android's permission dialog cannot be displayed on this image)"
  if [ -n "$DEVICE_LOST" ]; then
    log "A-dialog NOT RUN: the device was lost during $DEVICE_LOST"; record "A-dialog" "NOT RUN (emulator lost earlier)"; FAIL=1
  elif ! limit=$(phase_limit); then
    log "A-dialog NOT RUN: the ${BUDGET}s time budget is used up"; record "A-dialog" "NOT RUN (time budget)"; FAIL=1
  else
    sui_before=$(grep -c "Process: com.android.systemui" "$OUT/logcat.txt" 2>/dev/null)
    covered_before=$(grep -c "ZARVIS_DIAG.*front=android " "$OUT/logcat.txt" 2>/dev/null)
    timeout -k 10 "$limit" adb shell am instrument -w -r -e class "$APP.PermissionDialogFlowTest#b_learnMoreThenDenyInTheRealDialogIsVerifiedDenied,$APP.PermissionDialogFlowTest#c_allowInTheRealDialogIsVerifiedGranted,$APP.PermissionDialogFlowTest#d_permanentDenialLeadsToSettingsAndStaysDenied,$APP.PermissionDialogFlowTest#f_microphoneDeniedKeepsTextInput" "$RUNNER" > "$OUT/instr-A-dialog.txt" 2>&1
    sleep 2
    sui_new=$(( $(grep -c "Process: com.android.systemui" "$OUT/logcat.txt" 2>/dev/null) - sui_before ))
    covered_new=$(( $(grep -c "ZARVIS_DIAG.*front=android " "$OUT/logcat.txt" 2>/dev/null) - covered_before ))
    grep -E "INSTRUMENTATION_STATUS: test=|^OK|Tests run|FAILURES" "$OUT/instr-A-dialog.txt" | head -40
    if ! device_ok; then
      DEVICE_LOST="A-dialog"; infra_diagnostics "A-dialog"; record "A-dialog" "EMULATOR LOST (infrastructure failure; no ZARVIS result)"; FAIL=1
    elif grep -q "^OK (" "$OUT/instr-A-dialog.txt"; then
      log "A-dialog PASSED (the dialog was displayed after all)"; record "A-dialog" "PASSED"
    elif [ "$sui_new" -gt 0 ] || [ "$covered_new" -gt 0 ]; then
      # Blocked only with evidence from this very run: System UI crashed, or its crash dialog
      # (package "android") was in front when a test waited for Android's permission dialog.
      log "A-dialog PLATFORM-BLOCKED: runtime-permission dialog flow UNVERIFIED on API $API (System UI crashed $sui_new time(s), crash dialog in front $covered_new time(s) during these tests); not counted as a pass"
      echo "ZARVIS_EVIDENCE sdk=$API permission_dialog_flow UNVERIFIED platform-blocked (System UI NPE in StatusBar.onKeyguardOccludedChanged each time Android shows GrantPermissionsActivity; this run: systemui_crashes=$sui_new crash_dialog_in_front=$covered_new)" >> "$OUT/platform-blocked.txt"
      record "A-dialog" "PLATFORM-BLOCKED (systemui_crashes=$sui_new, crash_dialog_in_front=$covered_new)"
    else
      # No sign of the platform defect in this run: a real failure, not a blocked platform.
      log "A-dialog FAILED: no System UI crash and no crash dialog during these tests"; phase_diagnostics "A-dialog"
      record "A-dialog" "FAILED"; APP_FAILED=1; FAIL=1
    fi
  fi
else
  run_classes A "$APP.EmulatorSmokeTest,$APP.PermissionDialogFlowTest"
fi

if run_classes B1 "$APP.ProcessDeathPhase1" expect-crash; then
  sleep 2
  # Captured first: `logcat -d | grep -q` under pipefail can report a miss when grep exits early
  # and logcat gets SIGPIPE.
  b1log=$(adbt 60 logcat -d 2>/dev/null)
  if grep -q "process_death phase1 pending saved" <<< "$b1log"; then log "B1 evidence present"; else log "B1 evidence missing"; FAIL=1; APP_FAILED=1; fi
fi
run_classes B2 "$APP.ProcessDeathPhase2"

for scenario in scripts/emulator/scenarios/*.sh; do
  name=$(basename "$scenario" .sh)
  if [ -n "$DEVICE_LOST" ]; then log "scenario $name NOT RUN: the device was lost during $DEVICE_LOST"; record "scenario $name" "NOT RUN (emulator lost earlier)"; FAIL=1; continue; fi
  if ! phase_limit >/dev/null; then log "scenario $name NOT RUN: the ${BUDGET}s time budget is used up"; record "scenario $name" "NOT RUN (time budget)"; FAIL=1; continue; fi
  log "scenario $name"
  if timeout -k 10 300 bash "$scenario" "$API" "$OUT" > "$OUT/scenario-$name.txt" 2>&1; then
    log "scenario $name PASSED"; record "scenario $name" "PASSED"
  elif ! device_ok; then
    DEVICE_LOST="scenario $name"; infra_diagnostics "scenario-$name"; record "scenario $name" "EMULATOR LOST (infrastructure failure; no ZARVIS result)"; FAIL=1
  else
    log "scenario $name FAILED"; phase_diagnostics "scenario-$name"; record "scenario $name" "FAILED"; APP_FAILED=1; FAIL=1
  fi
  cat "$OUT/scenario-$name.txt"
done

# Fault injection, to prove the run still ends (with diagnostics) when the emulator dies mid-run:
# ZARVIS_FAULT_INJECT=device-loss-before-D kills the emulator before phase D;
# ZARVIS_FAULT_INJECT=device-loss-during-D kills it 40 s into phase D (see run_classes). Emulator
# only, off unless that variable is set; it never makes a run pass.
if [ "${ZARVIS_FAULT_INJECT:-}" = "device-loss-before-D" ] && [ "$DEVICE" != 1 ]; then
  log "FAULT INJECTION: killing the emulator before phase D"
  adbt 20 emu kill || true
  sleep 10
  FAIL=1
fi

# Keep feeding GPS fixes while phase D runs (a single fix goes stale before the location test).
if [ "$DEVICE" != 1 ] && [ -z "$DEVICE_LOST" ]; then
  ( while true; do timeout -k 2 10 adb emu geo fix 87.2677 26.2987 >/dev/null 2>&1; sleep 3; done ) &
  GEO_PID=$!
fi
run_classes D "$APP.SpecialAccessTest,$APP.DeviceCapabilityTest"
# E: the Settings UI in a fresh process, independent of D's accessibility-service toggling.
run_classes E "$APP.SettingsUiTest"
# F: one user turn = one execution across Activity recreation, rotation and background.
run_classes F "$APP.ConversationLifecycleTest"

[ -n "$GEO_PID" ] && kill "$GEO_PID" 2>/dev/null || true
sleep 1
if [ -z "$DEVICE_LOST" ]; then adbt 60 logcat -d > "$OUT/logcat-final.txt" 2>&1 || true; fi
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

log "phase summary (${SECONDS}s of the ${BUDGET}s budget):"
for r in "${RESULTS[@]}"; do log "  $r"; done
if [ -n "$DEVICE_LOST" ]; then
  log "RESULT: INFRASTRUCTURE FAILURE - the emulator/device stopped responding during $DEVICE_LOST; every phase after it was NOT RUN. This is not a ZARVIS test failure and not a pass (see infra-*.txt)."
fi
[ "$APP_FAILED" = 1 ] && log "RESULT: ZARVIS test failures above (FAILED / TIMED OUT)."
summary=$(printf '%s\n' "${RESULTS[@]}")
grep -q "NOT RUN (time budget)" <<< "$summary" && log "RESULT: INCOMPLETE - phases were NOT RUN because the ${BUDGET}s time budget was used up; not a pass."
if [ "$FAIL" = 0 ]; then
  if [ -s "$OUT/platform-blocked.txt" ]; then
    log "RESULT: every runnable phase passed; NOT counted as passed (PLATFORM-BLOCKED):"; sed 's/^/  /' "$OUT/platform-blocked.txt"
  else
    log "RESULT: all phases passed."
  fi
fi
[ -s "$OUT/infra-notes.txt" ] && { log "infrastructure notes:"; sed 's/^/  /' "$OUT/infra-notes.txt"; }
# A lost emulator with no ZARVIS failure before it is an infrastructure result (exit 3), so CI
# and the device driver can tell it apart from a ZARVIS test failure (exit 1).
if [ -n "$DEVICE_LOST" ] && [ "$APP_FAILED" = 0 ]; then exit 3; fi
exit $FAIL
