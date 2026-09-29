#!/usr/bin/env bash
# Revocation while backgrounded: Android kills the app process when a runtime permission is
# revoked. On the next launch ZARVIS must notice (from Android's live state, not a stored
# flag) and tell the user. Evidence: pid before/after, and the banner text in the UI dump.
set -uo pipefail
API="$1"; OUT="$2"; APP=com.zarvismobile.app
# Exact-name match on the app's own processes (pidof can also report other processes).
app_pids() { adb shell ps -A -o PID,USER,NAME 2>/dev/null | tr -d '\r' | awk -v n="$APP" '$3==n {print $1}' | tr '\n' ' ' | sed 's/ $//'; }
ui_has() { adb shell uiautomator dump /sdcard/zarvis-ui.xml >/dev/null 2>&1; adb shell cat /sdcard/zarvis-ui.xml | grep -q "$1"; }

# Start from exactly one fresh app process (no leftover instrumentation process).
adb shell am force-stop $APP
sleep 1
adb shell pm grant $APP android.permission.RECORD_AUDIO
adb shell am start -W -n $APP/.MainActivity
sleep 10   # startup; the resume check records "microphone granted"
adb shell input keyevent KEYCODE_HOME
sleep 2
adb shell ps -A -o PID,USER,NAME | grep -i zarvis | sed "s/^/ps before: /"
before=$(app_pids)
adb shell pm revoke $APP android.permission.RECORD_AUDIO
sleep 3
adb shell ps -A -o PID,USER,NAME | grep -i zarvis | sed "s/^/ps after: /"
after=$(app_pids)
echo "ZARVIS_EVIDENCE sdk=$API revoke pid_before=$before pid_after=${after:-none}"
if [ -z "$before" ]; then echo "app process was not running before the revoke"; exit 1; fi
for pid in $before; do
  for now in $after; do
    if [ "$pid" = "$now" ]; then echo "process $pid survived the revoke"; exit 1; fi
  done
done

adb shell am start -W -n $APP/.MainActivity
for _ in $(seq 1 20); do
  if ui_has "Microphone access was turned off"; then
    echo "ZARVIS_EVIDENCE sdk=$API revoke banner shown after restart: Microphone access was turned off in Android settings"
    adb shell input keyevent KEYCODE_HOME
    exit 0
  fi
  sleep 1
done
echo "revocation banner not shown"; adb shell cat /sdcard/zarvis-ui.xml | head -c 3000; exit 1
