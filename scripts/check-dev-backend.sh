#!/usr/bin/env bash
#
# Checks that the local dev backend is reachable the way a PHYSICAL PHONE reaches it — over
# the LAN, not over loopback — and prints the exact Gradle command to build a debug APK
# pointed at this machine.
#
#   ./scripts/check-dev-backend.sh [host] [port]
#
# With no arguments it auto-detects this machine's LAN IPv4 (the same address
# android/app/build.gradle.kts bakes into BuildConfig.API_BASE_URL) and uses port 3000.
#
# A phone can only reach the backend if all three of these hold, which is what this checks:
#   1. the backend process is running                     (curl on loopback succeeds)
#   2. it is bound to all interfaces, not just loopback   (curl on the LAN IP succeeds)
#   3. nothing local blocks inbound connections on it     (same curl, from off-loopback)
# What it cannot check from here is the phone's own path to this machine: a host firewall
# rule, or Wi-Fi client isolation (common on guest/corporate/hotel networks), can still drop
# the traffic. See DEVELOPMENT.md.
set -euo pipefail

PORT="${2:-${ZARVIS_DEV_API_PORT:-3000}}"

detect_lan_ip() {
  if command -v ip >/dev/null 2>&1; then
    # The source address the kernel would use to reach the internet — i.e. the LAN address.
    ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1 && return 0
  fi
  if command -v ipconfig >/dev/null 2>&1; then   # macOS
    ipconfig getifaddr en0 2>/dev/null && return 0
    ipconfig getifaddr en1 2>/dev/null && return 0
  fi
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' | head -n 1 && return 0
  fi
  return 0
}

HOST="${1:-${ZARVIS_DEV_API_HOST:-$(detect_lan_ip)}}"

if [ -z "$HOST" ]; then
  echo "Could not auto-detect a LAN address for this machine." >&2
  echo "Pass one explicitly: ./scripts/check-dev-backend.sh <your-lan-ip> [port]" >&2
  exit 2
fi

probe() { # url -> prints the body, fails on non-2xx or no connection
  curl --silent --show-error --fail --max-time 5 "$1"
}

echo "Dev backend check"
echo "  host : $HOST"
echo "  port : $PORT"
echo

status=0

echo -n "1. backend running (http://127.0.0.1:$PORT/health) ... "
if body=$(probe "http://127.0.0.1:$PORT/health" 2>/dev/null); then
  echo "OK  $body"
else
  echo "FAILED"
  echo "   Nothing is answering on loopback. Start it with:  cd backend && npm run dev" >&2
  status=1
fi

echo -n "2. reachable over the LAN (http://$HOST:$PORT/health) ... "
if body=$(probe "http://$HOST:$PORT/health" 2>/dev/null); then
  echo "OK  $body"
else
  echo "FAILED"
  echo "   The backend is not answering on this machine's LAN address, so a phone cannot" >&2
  echo "   reach it either. Check that it binds all interfaces (backend/src/index.ts calls" >&2
  echo "   app.listen(port) with no host argument, which does) and that a local firewall is" >&2
  echo "   not blocking inbound TCP $PORT." >&2
  status=1
fi

echo
if [ "$status" -eq 0 ]; then
  echo "Backend is reachable at http://$HOST:$PORT/ — build the app for a physical phone with:"
  echo
  echo "  cd android && ./gradlew :app:assembleDebug -Pzarvis.devApiHost=$HOST -Pzarvis.devApiPort=$PORT"
  echo
  echo "Then, from the phone's browser on the same Wi-Fi, open http://$HOST:$PORT/health to"
  echo "confirm the phone itself has a route (this script can only prove this machine does)."
else
  echo "Fix the failures above before building — the app cannot reach a backend this machine cannot." >&2
fi

exit "$status"
