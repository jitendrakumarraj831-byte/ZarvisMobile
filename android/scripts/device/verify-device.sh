#!/usr/bin/env bash
# Phase 1 verification on a PHYSICAL Android phone.
#
# Run on the computer the phone is plugged into (USB debugging on, the phone unlocked), from
# android/, with the backend running locally (cd backend && PORT=3000 npm run dev):
#
#   ZARVIS_DEVICE_RESET_OK=1 bash scripts/device/verify-device.sh
#
# It runs the same phases as the emulator CI (scripts/emulator/verify.sh A–E) against the real
# phone and writes the evidence to build/emulator-evidence/.
#
# What it changes on the phone, and how it is put back:
#   - ZARVIS is uninstalled first (the permission tests need a fresh install), then reinstalled
#     as the debug build pointed at this computer's backend (via `adb reverse`, port 3000).
#   - Notification access, accessibility services, the default assistant and the screen timeout
#     are switched during the run. Their current values are saved first and restored on exit
#     (also after a failure or Ctrl-C); the restored values are checked and any difference is
#     printed with what to re-select by hand.
#   - The lock screen is never touched.
#   - No phone call is placed unless you pass a number you own: ZARVIS_TEST_CALL_NUMBER=<number>.
#     Without it the call test is recorded as UNVERIFIED, never as passed.
#   - The phone's real location is used for the location check and is redacted in the logs.
#
# Build only (no phone needed; checks the APKs build on this computer, with a hang watchdog):
#   ZARVIS_BUILD_ONLY=1 bash scripts/device/verify-device.sh
#
# Before you start: set the phone's language to English (the UI tests read on-screen labels),
# turn location on, and clear or silence notifications. The notification tests read the
# notifications on the phone; if a check fails, its failure message can quote them, and that
# output stays in build/emulator-evidence/ on your computer.
set -uo pipefail
cd "$(dirname "$0")/../.."
# Git Bash on Windows rewrites arguments that start with "/" (e.g. /sdcard/…) into Windows
# paths before they reach adb.exe; turn that off for everything this run starts.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

APP=com.zarvismobile.app
PORT="${ZARVIS_BACKEND_PORT:-3000}"
say() { echo "[verify-device] $*"; }

if [ "${ZARVIS_BUILD_ONLY:-}" = 1 ]; then
  ZARVIS_DEV_API_HOST=127.0.0.1 exec bash scripts/device/build-apks.sh -Pzarvis.devApiHost=127.0.0.1 -Pzarvis.devApiPort="$PORT"
fi

if [ "${ZARVIS_DEVICE_RESET_OK:-}" != 1 ]; then
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
  say "Re-run with ZARVIS_DEVICE_RESET_OK=1 once you accept the changes above (ZARVIS's data on the phone is erased)."
  exit 2
fi

command -v adb >/dev/null || { say "adb not found (Android SDK platform-tools); add <sdk>/platform-tools to PATH"; exit 1; }
timeout --version >/dev/null 2>&1 || { say "GNU 'timeout' not found (Git Bash normally has it in /usr/bin); check PATH order"; exit 1; }
# adb on Windows ends lines with \r; strip it before comparing.
count=$(adb devices | tr -d '\r' | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')
[ "$count" = 1 ] || { say "exactly one device must be connected (found $count); see 'adb devices'"; exit 1; }
if [ "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" = 1 ]; then
  say "this is an emulator; use scripts/emulator/verify.sh for emulators"; exit 1
fi
API=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
MODEL="$(adb shell getprop ro.product.manufacturer | tr -d '\r') $(adb shell getprop ro.product.model | tr -d '\r')"
say "device: $MODEL, Android API $API"

curl -sf --max-time 3 "http://localhost:$PORT/health" >/dev/null || {
  say "backend not reachable on localhost:$PORT — start it first: (cd ../backend && PORT=$PORT npm run dev)"; exit 1; }

OUT=build/emulator-evidence
mkdir -p "$OUT"
SNAP="$OUT/device-settings-before.txt"
SECURE_KEYS="enabled_notification_listeners enabled_accessibility_services accessibility_enabled assistant voice_interaction_service voice_recognition_service"
: > "$SNAP"
for key in $SECURE_KEYS; do echo "secure $key=$(adb shell settings get secure $key | tr -d '\r')" >> "$SNAP"; done
echo "system screen_off_timeout=$(adb shell settings get system screen_off_timeout | tr -d '\r')" >> "$SNAP"
echo "global stay_on_while_plugged_in=$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')" >> "$SNAP"
ASSISTANT_HOLDERS=""
if [ "$API" -ge 29 ]; then
  ASSISTANT_HOLDERS=$(adb shell cmd role get-role-holders android.app.role.ASSISTANT 2>/dev/null | tr -d '\r' | tr ';' ' ')
  echo "role ASSISTANT=$ASSISTANT_HOLDERS" >> "$SNAP"
fi
say "saved the phone's current settings to $SNAP"

restore() {
  say "restoring the phone's settings"
  while IFS= read -r line; do
    ns=${line%% *}; kv=${line#* }; key=${kv%%=*}; val=${kv#*=}
    [ "$ns" = role ] && continue
    if [ "$val" = null ] || [ -z "$val" ]; then adb shell settings delete "$ns" "$key" >/dev/null 2>&1
    else adb shell settings put "$ns" "$key" "'$val'" >/dev/null 2>&1; fi
  done < "$SNAP"
  if [ "$API" -ge 29 ]; then
    adb shell cmd role remove-role-holder android.app.role.ASSISTANT $APP >/dev/null 2>&1
    for holder in $ASSISTANT_HOLDERS; do adb shell cmd role add-role-holder android.app.role.ASSISTANT "$holder" >/dev/null 2>&1; done
  fi
  adb reverse --remove "tcp:$PORT" >/dev/null 2>&1
  # Check what actually came back.
  local diff=0
  while IFS= read -r line; do
    ns=${line%% *}; kv=${line#* }; key=${kv%%=*}; want=${kv#*=}
    if [ "$ns" = role ]; then
      now=$(adb shell cmd role get-role-holders android.app.role.ASSISTANT 2>/dev/null | tr -d '\r' | tr ';' ' ')
      [ "$now" = "$want" ] || { say "NOT RESTORED: default assistant is '$now', was '$want' — re-select it in Settings > Apps > Default apps > Digital assistant app"; diff=1; }
      continue
    fi
    now=$(adb shell settings get "$ns" "$key" | tr -d '\r')
    [ "$now" = "$want" ] || { say "NOT RESTORED: $ns $key is '$now', was '$want'"; diff=1; }
  done < "$SNAP"
  [ "$diff" = 0 ] && say "all saved settings are back to their previous values"
}
trap restore EXIT

adb reverse "tcp:$PORT" "tcp:$PORT" || { say "adb reverse failed"; exit 1; }
adb shell settings put global stay_on_while_plugged_in 7 >/dev/null 2>&1

if [ "${ZARVIS_SKIP_BUILD:-}" != 1 ]; then
  bash scripts/device/build-apks.sh -Pzarvis.devApiHost=127.0.0.1 -Pzarvis.devApiPort="$PORT" \
    || { say "build failed or stalled — see build/build-diagnostics/ (nothing on the phone was changed yet except what is restored on exit)"; exit 1; }
fi
[ -f app/build/outputs/apk/debug/app-debug.apk ] && [ -f app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk ] \
  || { say "APKs missing — run without ZARVIS_SKIP_BUILD"; exit 1; }
adb uninstall $APP >/dev/null 2>&1
adb uninstall $APP.test >/dev/null 2>&1

say "Keep the phone unlocked and on its home screen; don't touch it until this finishes (about 20 minutes)."
[ -t 0 ] && read -r -p "[verify-device] Press Enter when the phone is unlocked… " _

ARGS=""
[ -n "${ZARVIS_TEST_CALL_NUMBER:-}" ] && ARGS="-e callNumber ${ZARVIS_TEST_CALL_NUMBER}"
ZARVIS_PHYSICAL_DEVICE=1 ZARVIS_INSTR_ARGS="$ARGS" bash scripts/emulator/verify.sh "$API"
status=$?
{
  echo "device=$MODEL api=$API"
  echo "result_exit=$status"
  grep -h "UNVERIFIED\|fix_obtained" "$OUT/evidence.txt" 2>/dev/null
} > "$OUT/device-summary.txt"
say "summary:"; cat "$OUT/device-summary.txt"
exit $status
