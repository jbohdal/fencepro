#!/bin/bash
# Heavy browser test runs, made safe for the live app on this Mac.
#
# Jonathan's rule (Oct 30, 2026, replacing the Oct 23 night-only rule): work
# and deploy by day as soon as a change is ready, running the suites that cover
# it; the full run of every suite (and the iPhone run) is the nightly safety
# net. This wrapper:
#   - runs named suites (`suites a b`) and other commands at any hour;
#   - refuses `all` between 07:00 and 18:00 local, unless FORCE_BUSINESS_HOURS=1;
#   - refuses APP_URL / API_URL on port 4000 or a Tailscale address (live);
#   - runs everything at low priority: nice -n 15 and taskpolicy -b (macOS
#     background: low CPU and disk priority, the live server goes first);
#   - shuts down the Android emulator and every booted iOS simulator at the
#     end (also after a failure or Ctrl-C), and the Playwright browsers it left.
#
# Usage (from anywhere):
#   bash apps/web/e2e/run-heavy.sh all                   every suite on the dev copy, one at a time (log per suite)
#   bash apps/web/e2e/run-heavy.sh suites a b c          those suites (a.mjs, b.mjs, c.mjs), one at a time
#   bash apps/web/e2e/run-heavy.sh -- <command ...>      any other heavy command (an emulator run, a long loop)
#
# Settings (environment):
#   APP_URL, API_URL           default http://localhost:4001 (the dev copy)
#   E2E_ACCESS_TOKEN / E2E_STAFF_COOKIE   the dev sign in (required by the suites)
#   LOGS=<folder>              where the logs go (default ~/Downloads/ezbiz-e2e-<date-time>)
#   PAUSE=<seconds>            pause between suites (default 20): the server settles
#   SKIP="a b"                 suites to leave out of `all`
#   FORCE_BUSINESS_HOURS=1     run `all` between 07:00 and 18:00 anyway (only when Jonathan asks)
#   KEEP_DEVICES=1             leave the emulator and simulators running at the end
#
# The check alone (exit 0 = allowed now):  bash apps/web/e2e/run-heavy.sh --check

set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOUR=$((10#$(date +%H)))

business_hours() { [ "$HOUR" -ge 7 ] && [ "$HOUR" -lt 18 ]; }

if [ "${1:-}" = "all" ] && business_hours && [ "${FORCE_BUSINESS_HOURS:-}" != "1" ]; then
  echo "Refusing: it is $(date +%H:%M), inside business hours (07:00-18:00). The full run is the nightly safety net."
  echo "By day, run the suites that cover the change: bash apps/web/e2e/run-heavy.sh suites a b c"
  exit 3
fi
[ "${1:-}" = "--check" ] && { echo "Allowed now ($(date +%H:%M))."; exit 0; }

export APP_URL="${APP_URL:-http://localhost:4001}" API_URL="${API_URL:-http://localhost:4001}"
for u in "$APP_URL" "$API_URL" "${CDP_URL:-}"; do
  case "$u" in
    *:4000|*:4000/*|*.ts.net*|*//100.*) echo "Refusing: $u is the live server. Heavy runs are for the dev copy (port 4001)."; exit 2 ;;
  esac
done

# The website widget's key for the dev copy (estimate-match and others), from the dev settings; never printed.
if [ -z "${EZ_QUOTE_WIDGET_TOKEN:-}" ] && [ -f "$HERE/../../portal/.env" ]; then
  EZ_QUOTE_WIDGET_TOKEN="$(grep '^EZ_QUOTE_WIDGET_TOKEN=' "$HERE/../../portal/.env" | head -1 | cut -d= -f2- | tr -d '"')"
  export EZ_QUOTE_WIDGET_TOKEN
fi

# A made up test photo and video (generated, no real job) for the suites that upload media.
export MEDIA_PHOTO="${MEDIA_PHOTO:-$HERE/fixtures/test-photo.jpg}" MEDIA_VIDEO="${MEDIA_VIDEO:-$HERE/fixtures/test-video.mp4}"

LOW=(nice -n 15)
command -v taskpolicy >/dev/null 2>&1 && LOW=(nice -n 15 taskpolicy -b)

cleanup() {
  [ "${KEEP_DEVICES:-}" = "1" ] && return
  # The Android emulator(s): asked to close, then stopped if still there.
  local adb="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
  command -v adb >/dev/null 2>&1 && adb="adb"
  if [ -x "$adb" ] || command -v "$adb" >/dev/null 2>&1; then
    for d in $("$adb" devices 2>/dev/null | awk '/^emulator-/{print $1}'); do "$adb" -s "$d" emu kill >/dev/null 2>&1; done
  fi
  pkill -f 'qemu-system-.*-avd' >/dev/null 2>&1
  # Every booted iOS simulator, and the Simulator app.
  command -v xcrun >/dev/null 2>&1 && xcrun simctl shutdown all >/dev/null 2>&1
  pkill -x Simulator >/dev/null 2>&1
  # Playwright browsers this run left behind (only Playwright's own builds): this run's own, and orphans (their
  # test is gone, parent 1). Never another run's live browsers: a blanket pkill here closed the browser under a
  # suite another agent was running on its own server at the same time (Oct 27 2026, round1-fixes).
  ps -A -o pid= -o ppid= -o command= | awk -v me="$$" '
    { pid[NR] = $1; par[NR] = $2; pw[NR] = ($3 ~ /ms-playwright\//) }
    END {
      mine[me] = 1
      do { grew = 0; for (i = 1; i <= NR; i++) if ((par[i] in mine) && !(pid[i] in mine)) { mine[pid[i]] = 1; grew = 1 } } while (grew)
      for (i = 1; i <= NR; i++) if (pw[i] && ((pid[i] in mine) || par[i] == 1)) print pid[i]
    }' | xargs kill 2>/dev/null
  echo "Emulator, simulators and test browsers shut down."
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Suites: every test script, not the shared helpers, the read only live checks
# or the public site checks (those have their own rules, see README.md).
# The reviewers' hand run checks need settings `all` cannot give (a sent quote's id, office and Salesman cookies, their
# own server): run each by hand with the settings in its header (sent-tiers, small-fixes-1028, review-1028-fixes,
# review-1028-office, audit-47-48 (the four role cookies), board-moves-round2 (DRAWN_JOB, REPAIR_JOB), salesman-choice and
# salesman-choice-booking (the owner's, a Salesman's and the office's TOKEN and COOKIE)).
NOT_SUITES=" lib devOnly photoTiles signal sharedLock live-readonly perf-phone godaddy-embed real-site-embed widget-draw-public iphone-safari two-browser-sync intake sent-tiers small-fixes-1028 review-1028-fixes review-1028-office audit-47-48 board-moves-round2 salesman-choice salesman-choice-booking "
all_suites() {
  for f in "$HERE"/*.mjs; do
    n="$(basename "$f" .mjs)"
    case "$NOT_SUITES ${SKIP:-} " in *" $n "*) continue ;; esac
    echo "$n"
  done
}

run_suites() {
  local logs="${LOGS:-$HOME/Downloads/ezbiz-e2e-$(date +%Y-%m-%d-%H%M)}"
  mkdir -p "$logs"
  local pass=0 fail=0 failed=()
  cd "$HERE" || exit 2
  for n in "$@"; do
    [ -f "$n.mjs" ] || { echo "No suite $n.mjs"; fail=$((fail+1)); failed+=("$n (missing)"); continue; }
    echo "=== $n  ($(date +%H:%M:%S))"
    if "${LOW[@]}" node "$n.mjs" > "$logs/$n.log" 2>&1; then pass=$((pass+1)); echo "    ok"
    else fail=$((fail+1)); failed+=("$n"); echo "    FAILED (exit $?): $logs/$n.log"; grep -E '^FAIL' "$logs/$n.log" | head -5 | sed 's/^/      /'; fi
    sleep "${PAUSE:-20}"
  done
  echo
  echo "Suites passed: $pass, failed: $fail. Logs: $logs"
  [ "$fail" -eq 0 ] || { printf '  failed: %s\n' "${failed[@]}"; return 1; }
}

case "${1:-}" in
  all) shift; S=(); while IFS= read -r n; do S+=("$n"); done < <(all_suites); run_suites "${S[@]}" ;;
  suites) shift; [ "$#" -gt 0 ] || { echo "Name the suites."; exit 2; }; run_suites "$@" ;;
  --) shift; [ "$#" -gt 0 ] || { echo "Give the command after --."; exit 2; }; "${LOW[@]}" "$@" ;;
  *) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
