#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap — see DEVELOPMENT.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v java >/dev/null 2>&1 || ! java -version 2>&1 | grep -qE 'version "(1[789]|2[0-9])'; then
  if command -v apt-get >/dev/null 2>&1; then
    sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-17-jdk
  else
    echo "OpenJDK 17+ is required for android/domain (jvmToolchain 17)." >&2
    exit 1
  fi
fi
if [[ -d /usr/lib/jvm/java-17-openjdk-amd64 ]]; then
  export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
fi

cd "$ROOT/backend"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build

cd "$ROOT/android"
chmod +x gradlew
./gradlew :domain:build --no-daemon -q
