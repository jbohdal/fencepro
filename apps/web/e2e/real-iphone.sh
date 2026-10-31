#!/bin/bash
# The app in Safari on the owner's real iPhone, by cable, with its memory recorded (item 17: the simulator's
# Safari page process reached about 817 MB; does a real iPhone hold on, or does the page crash?).
#
#   APP_URL=http://localhost:<dev port> API_URL=same PHONE_URL=http://<this Mac's Wi-Fi address>:<dev port> \
#     E2E_ACCESS_TOKEN=... E2E_STAFF_COOKIE=... bash apps/web/e2e/real-iphone.sh [out folder]
#
# The dev server on that port runs with HOST=0.0.0.0 for this run only, on the dev database, gate shut. Never port 4000.
# Writes: <out>/run.log (the checks) and <out>/memory.trace (open it in Instruments, or read it with xctrace export).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ID="${REAL_IPHONE:-00008110-001C444E1EA8201E}"
OUT="${1:-$(mktemp -d)}"; mkdir -p "$OUT"
case "${APP_URL:-}|${PHONE_URL:-}" in *:4000*|"|"*|*"|") echo "Set APP_URL and PHONE_URL to the dev server, never port 4000."; exit 2 ;; esac

xcrun devicectl list devices 2>/dev/null | grep -q 'connected\|available (paired)' || { echo "The iPhone is not connected: cable, unlocked, Trust this computer, Developer Mode on."; exit 3; }

xcrun xctrace record --template 'Activity Monitor' --device "$ID" --all-processes --time-limit 40m --output "$OUT/memory.trace" >"$OUT/xctrace.log" 2>&1 &
TRACE=$!
sleep 15
kill -0 "$TRACE" 2>/dev/null || { echo "Memory recording did not start:"; tail -5 "$OUT/xctrace.log"; echo "The usual reason is an Xcode older than the iPhone's iOS. The Safari run goes on without it."; TRACE=; }

(cd "$HERE/.." && REAL_IPHONE="$ID" AREAS="${AREAS:-fit,quote,reload}" node e2e/iphone-safari.mjs) 2>&1 | tee "$OUT/run.log"
code=${PIPESTATUS[0]}
[ -n "$TRACE" ] && { kill -INT "$TRACE" 2>/dev/null; wait "$TRACE" 2>/dev/null; }
echo "Done (exit $code). Logs: $OUT"
exit "$code"
