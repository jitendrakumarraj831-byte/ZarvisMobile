#!/usr/bin/env bash
# Self-test of verify.sh itself (workflow job "harness-selftest"), on a real emulator: kills the
# emulator 40 s into phase D, the failure that hung the API 26 job on 2026-10-03 for 51 minutes
# with no output. Passes only if verify.sh then
#   - stops on its own, well inside the bound (no wait on the vanished device),
#   - exits 3 (infrastructure failure: never 0, never reported as a ZARVIS test failure),
#   - reports D as EMULATOR LOST and E and F as NOT RUN, and nothing after D as PASSED.
set -uo pipefail
API="${1:?api level}"
BOUND_S="${ZARVIS_SELFTEST_BOUND_S:-1200}"
LOG="build/emulator-evidence/selftest-verify.txt"
mkdir -p build/emulator-evidence

start=$(date +%s)
ZARVIS_FAULT_INJECT=device-loss-during-D timeout "$BOUND_S" bash scripts/emulator/verify.sh "$API" 2>&1 | tee "$LOG"
rc=${PIPESTATUS[0]}
elapsed=$(( $(date +%s) - start ))
echo "[selftest] verify.sh exit=$rc after ${elapsed}s (bound ${BOUND_S}s)"

ok=1
check() { if eval "$2"; then echo "[selftest] PASS $1"; else echo "[selftest] FAIL $1"; ok=0; fi; }
check "verify.sh stopped by itself (not killed by the ${BOUND_S}s bound)" '[ "$rc" -ne 124 ]'
check "exit code 3 = infrastructure failure" '[ "$rc" -eq 3 ]'
check "the fault was injected in phase D" 'grep -q "FAULT INJECTION" "$LOG"'
check "D is reported as EMULATOR LOST" 'grep -q "D EMULATOR LOST" "$LOG"'
check "E is NOT RUN" 'grep -q "E NOT RUN: the device was lost during D" "$LOG"'
check "F is NOT RUN" 'grep -q "F NOT RUN: the device was lost during D" "$LOG"'
check "the summary says EMULATOR LOST for D" 'grep -q "  D: EMULATOR LOST" "$LOG"'
# Captured first: `! sed | grep -q` under pipefail would pass if sed got SIGPIPE.
# shellcheck disable=SC2034  # read inside the eval of check() below
after_d=$(sed -n "/instrumentation D/,\$p" "$LOG")
check "nothing after D is reported as passed" '! grep -qE "\] +(D|E|F)(: PASSED| PASSED)|all phases passed|every runnable phase passed" <<< "$after_d"'
check "host diagnostics were captured" '[ -s build/emulator-evidence/infra-D.txt ]'
[ "$ok" = 1 ] && { echo "[selftest] RESULT: harness terminates and classifies a lost emulator correctly"; exit 0; }
echo "[selftest] RESULT: harness self-test FAILED"; exit 1
