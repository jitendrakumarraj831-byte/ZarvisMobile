#!/usr/bin/env bash
# Self-test for scripts/device/verify-device.sh — no phone needed.
#
# Runs the real driver against a fake `adb` that behaves like a physical phone (including the
# "\r" line endings adb prints on Windows) and a stub test run that changes the phone's
# special-access settings, then checks that the driver:
#   1. restores every saved setting and the default assistant after the tests FAIL,
#   2. restores them when the run is TERMINATED part-way (Ctrl-C / kill),
#   3. restores them when the build fails before any test ran,
#   4. refuses to run without consent, on an emulator, or with no device.
# Usage (from android/):  bash scripts/device/selftest.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
PASS=0; FAILS=0
ok() { echo "  ok   $*"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL $*"; FAILS=$((FAILS + 1)); }

WORK=$(mktemp -d)
trap 'kill "${HTTP_PID:-}" 2>/dev/null; rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin" "$WORK/state" "$WORK/android/scripts/device" "$WORK/android/scripts/emulator" \
  "$WORK/android/app/build/outputs/apk/debug" "$WORK/android/app/build/outputs/apk/androidTest/debug" "$WORK/www"
cp scripts/device/verify-device.sh "$WORK/android/scripts/device/"
touch "$WORK/android/app/build/outputs/apk/debug/app-debug.apk" "$WORK/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"

# --- fake adb: settings and role holders live in $STATE ------------------------------------
cat > "$WORK/bin/adb" <<'ADB'
#!/usr/bin/env bash
S="$FAKE_ADB_STATE"
cr=$'\r'
get() { grep -m1 "^$1 $2=" "$S/settings" 2>/dev/null | cut -d= -f2-; }
case "$1" in
  devices) printf 'List of devices attached%s\n' "$cr"; [ -f "$S/no-device" ] || printf 'FAKE123\tdevice%s\n' "$cr"; printf '%s\n' "$cr"; exit 0 ;;
  reverse|uninstall|install|wait-for-device|logcat) exit 0 ;;
  shell) shift ;;
  *) exit 0 ;;
esac
case "$1 $2" in
  "getprop ro.kernel.qemu") printf '%s%s\n' "$(cat "$S/qemu" 2>/dev/null)" "$cr" ;;
  "getprop ro.build.version.sdk") printf '34%s\n' "$cr" ;;
  "getprop ro.product.manufacturer") printf 'Nothing%s\n' "$cr" ;;
  "getprop ro.product.model") printf 'A142%s\n' "$cr" ;;
  "settings get") v=$(get "$3" "$4"); printf '%s%s\n' "${v:-null}" "$cr" ;;
  "settings put") v="$5"; v="${v#\'}"; v="${v%\'}"
                  grep -v "^$3 $4=" "$S/settings" > "$S/tmp" 2>/dev/null; echo "$3 $4=$v" >> "$S/tmp"; mv "$S/tmp" "$S/settings" ;;
  "settings delete") grep -v "^$3 $4=" "$S/settings" > "$S/tmp" 2>/dev/null; mv "$S/tmp" "$S/settings" ;;
  "cmd role")
    case "$3" in
      get-role-holders) printf '%s%s\n' "$(tr '\n' ';' < "$S/role" | sed 's/;$//')" "$cr" ;;
      add-role-holder) grep -qx "$5" "$S/role" || echo "$5" >> "$S/role" ;;
      remove-role-holder) grep -vx "$5" "$S/role" > "$S/tmp"; mv "$S/tmp" "$S/role" ;;
    esac ;;
esac
exit 0
ADB
chmod +x "$WORK/bin/adb"

# --- a backend health endpoint --------------------------------------------------------------
echo ok > "$WORK/www/health"
PORT=38123
PY=$(command -v python3 || command -v python) || { echo "python is needed for the fake backend"; exit 1; }
(cd "$WORK/www" && exec "$PY" -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) &
HTTP_PID=$!
for _ in $(seq 1 50); do curl -sf "http://localhost:$PORT/health" >/dev/null && break; sleep 0.1; done

reset_phone() {
  rm -f "$WORK/state/"*
  cat > "$WORK/state/settings" <<'SET'
secure enabled_notification_listeners=com.example.watch/.WatchListener:com.whatsapp/.Listener
secure enabled_accessibility_services=com.example.reader/.ReaderService
secure accessibility_enabled=1
secure assistant=com.google.android.googlequicksearchbox/com.google.android.voiceinteraction.GsaVoiceInteractionService
system screen_off_timeout=30000
global stay_on_while_plugged_in=0
SET
  echo "com.google.android.googlequicksearchbox" > "$WORK/state/role"
  cp "$WORK/state/settings" "$WORK/state/settings.orig"; cp "$WORK/state/role" "$WORK/state/role.orig"
}
# The stub test run: does what the real tests do to the phone, then ends as $STUB_MODE says.
cat > "$WORK/android/scripts/emulator/verify.sh" <<'STUB'
#!/usr/bin/env bash
adb shell settings put secure enabled_notification_listeners "'com.zarvismobile.app/com.zarvismobile.app.access.ZarvisNotificationListener'"
adb shell settings delete secure enabled_accessibility_services
adb shell settings put secure accessibility_enabled 0
adb shell settings put system screen_off_timeout 1800000
adb shell settings put global stay_on_while_plugged_in 7
adb shell cmd role remove-role-holder android.app.role.ASSISTANT com.google.android.googlequicksearchbox
adb shell cmd role add-role-holder android.app.role.ASSISTANT com.zarvismobile.app
mkdir -p build/emulator-evidence; echo "ZARVIS_EVIDENCE stub" > build/emulator-evidence/evidence.txt
case "$STUB_MODE" in
  fail) exit 1 ;;
  kill) kill -TERM "$PPID"; sleep 2; exit 0 ;;
esac
exit 0
STUB

run_driver() {  # extra env as args
  (cd "$WORK/android" && env PATH="$WORK/bin:$PATH" FAKE_ADB_STATE="$WORK/state" ZARVIS_BACKEND_PORT="$PORT" \
    ZARVIS_SKIP_BUILD=1 "$@" bash scripts/device/verify-device.sh < /dev/null > "$WORK/out.txt" 2>&1)
  echo $?
}
restored() {
  if diff <(sort "$WORK/state/settings.orig") <(sort "$WORK/state/settings") >/dev/null \
     && diff "$WORK/state/role.orig" "$WORK/state/role" >/dev/null; then return 0; fi
  diff <(sort "$WORK/state/settings.orig") <(sort "$WORK/state/settings"); diff "$WORK/state/role.orig" "$WORK/state/role"
  return 1
}

echo "verify-device.sh self-test"

reset_phone
code=$(run_driver ZARVIS_DEVICE_RESET_OK=)
[ "$code" = 2 ] && ok "refuses without ZARVIS_DEVICE_RESET_OK (exit 2)" || bad "no-consent exit $code"

reset_phone; echo 1 > "$WORK/state/qemu"
code=$(run_driver ZARVIS_DEVICE_RESET_OK=1)
[ "$code" = 1 ] && grep -q "this is an emulator" "$WORK/out.txt" && ok "refuses an emulator" || bad "emulator: exit $code"

reset_phone; touch "$WORK/state/no-device"
code=$(run_driver ZARVIS_DEVICE_RESET_OK=1)
[ "$code" = 1 ] && grep -q "found 0" "$WORK/out.txt" && ok "refuses with no device" || bad "no device: exit $code"

reset_phone
code=$(run_driver ZARVIS_DEVICE_RESET_OK=1 STUB_MODE=fail)
grep -q "device: Nothing A142, Android API 34" "$WORK/out.txt" && ok "detects the phone through Windows-style (\\r) adb output" || bad "device detection: $(head -5 "$WORK/out.txt")"
[ "$code" = 1 ] && ok "a failed test run exits non-zero ($code)" || bad "failed run exit $code"
restored && ok "settings + default assistant restored after FAILED tests" || bad "not restored after failed tests"
grep -q "all saved settings are back" "$WORK/out.txt" && ok "driver reports the restore was verified" || bad "no restore verification line"

reset_phone
code=$(run_driver ZARVIS_DEVICE_RESET_OK=1 STUB_MODE=kill)
[ "$code" != 0 ] && ok "a terminated run exits non-zero ($code)" || bad "terminated run exit 0"
restored && ok "settings + default assistant restored after the run was TERMINATED" || bad "not restored after termination"

reset_phone
rm -f "$WORK/android/app/build/outputs/apk/debug/app-debug.apk"
code=$(run_driver ZARVIS_DEVICE_RESET_OK=1 STUB_MODE=ok)
touch "$WORK/android/app/build/outputs/apk/debug/app-debug.apk"
[ "$code" = 1 ] && grep -q "APKs missing" "$WORK/out.txt" && ok "stops before touching tests when the APKs are missing" || bad "missing APK: exit $code"
restored && ok "settings unchanged/restored after a build problem" || bad "settings changed after build problem"

reset_phone
code=$(run_driver ZARVIS_DEVICE_RESET_OK=1 STUB_MODE=ok)
[ "$code" = 0 ] && restored && ok "a passing run exits 0 and restores everything" || bad "passing run exit $code"

echo "self-test: $PASS passed, $FAILS failed"
[ "$FAILS" = 0 ]
