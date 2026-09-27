#!/usr/bin/env bash
# Starts the dev backend if it is not already listening (mock AI + in-memory store by default).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${ZARVIS_DEV_API_PORT:-3000}"
LOG="${ZARVIS_BACKEND_LOG:-/tmp/zarvis-backend.log}"

health_url="http://127.0.0.1:${PORT}/health"

if curl --silent --fail --max-time 2 "$health_url" >/dev/null 2>&1; then
  exit 0
fi

cd "$ROOT/backend"
nohup npm run dev >>"$LOG" 2>&1 &
disown || true

for _ in $(seq 1 45); do
  if curl --silent --fail --max-time 2 "$health_url" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done

echo "Backend did not become healthy on ${health_url} — see ${LOG}" >&2
exit 1
