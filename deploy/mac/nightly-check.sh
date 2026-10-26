#!/bin/bash
# The nightly safety net (Jonathan, Oct 26 2026): "make the 3 job walkthrough plus
# the iPhone run an automatic nightly check after 6 pm. If anything that worked
# yesterday breaks, fix it before morning or tell me first thing."
#
# Runs from the WORKING FOLDER (never ~/ezbiz), on the dev copy only:
#   1. refuses before 18:00 (and from 07:00) and anywhere near live;
#   2. stops this check's own leftovers (its server, browsers, a Simulator left on);
#   3. refreshes the dev copy from live (deploy/mac/refresh-dev-db.sh: live is only
#      read, the copy is scrubbed) unless something else is using the dev copy;
#   4. checks out the current finalize in its own folder (.nightly/finalize), builds
#      it and starts its own server on a fixed port (4091), with the outbound gate
#      shut, after checking: ezbiz_dev, no phone push sign ups, the scrub mark;
#   5. runs apps/web/e2e/nightly-walkthrough.mjs and iphone-safari.mjs (every area,
#      then shuts the Simulator down), and stops its server;
#   6. reads new feedback from LIVE, read only (~/ezbiz's scripts/feedback-report.ts,
#      a read-only transaction; nothing on live is written);
#   7. writes ~/Downloads/ezbiz-nightly/YYYY-MM-DD/report.md (the first lines are the
#      morning summary; NEW FAILURES first) and results.json; keeps 30 nights;
#   8. when there are new failures or new feedback: the night agent (headless Claude
#      Code, deploy/mac/nightly-fix-prompt.md) fixes what is clear on a branch
#      nightly-fix/YYYY-MM-DD in its own worktree, never pushes or deploys, and its
#      summary goes to the top of the report.
#
#   bash deploy/mac/nightly-check.sh                 the real run (the LaunchAgent, 19:15)
#   bash deploy/mac/nightly-check.sh --dry-run       no refresh, no Simulator, and the night
#                                                    agent's command is written, not run
#   --skip-refresh  --skip-simulator  --skip-agent   one at a time
#
#   NIGHTLY_OUT=<folder>          where the nights go (default ~/Downloads/ezbiz-nightly)
#   NIGHTLY_REF=finalize          the branch (or commit) tested
#   NIGHTLY_PORT=4091             its own server's port (never 4000 or 4001)
#   NIGHTLY_FEEDBACK_DIR=<dir>    where feedback-report.ts runs (default ~/ezbiz/apps/portal: live, read only)
#   NIGHTLY_CLAUDE=<path>         the claude command (default: on the PATH, else the VS Code extension's)
#   NIGHTLY_AGENT_MINUTES=240     the night agent's time limit
#   FORCE_BUSINESS_HOURS=1        run before 18:00 (only when Jonathan asked)
#
# Install it as a LaunchAgent (19:15 every day): see GO_LIVE.md, section 20.
set -o pipefail

DRY=0; SKIP_REFRESH=0; SKIP_SIM=0; SKIP_AGENT=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1; SKIP_REFRESH=1; SKIP_SIM=1; SKIP_AGENT=1 ;;
    --skip-refresh) SKIP_REFRESH=1 ;;
    --skip-simulator) SKIP_SIM=1 ;;
    --skip-agent) SKIP_AGENT=1 ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done

export PATH="/opt/homebrew/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/local/bin:$HOME/.local/bin:$HOME/Library/pnpm:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LIVE_DIR="$HOME/ezbiz"
PORT="${NIGHTLY_PORT:-4091}"
FIX_PORT=$((PORT + 1))
DATE="$(date +%Y-%m-%d)"
OUT_ROOT="${NIGHTLY_OUT:-$HOME/Downloads/ezbiz-nightly}"
OUT="$OUT_ROOT/$DATE"
NH="$REPO/.nightly"           # the check's own folder in the working folder (git ignores it)
WT="$NH/finalize"             # finalize, checked out for tonight
FEEDBACK_DIR="${NIGHTLY_FEEDBACK_DIR:-$LIVE_DIR/apps/portal}"
DB="ezbiz_dev"
REF="${NIGHTLY_REF:-finalize}"

say() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$OUT/run.log"; }
fact() { local IFS=$'\t'; echo "$*" >> "$OUT/facts.tsv"; }
problem() { say "PROBLEM: $*"; fact problem "$*"; }

# ── 1. When and where ──
hour=$((10#$(date +%H)))
if [ "$hour" -ge 7 ] && [ "$hour" -lt 18 ] && [ "${FORCE_BUSINESS_HOURS:-}" != "1" ]; then
  echo "Refusing: the nightly check runs after 18:00 (Jonathan uses the live app on this Mac until then). It is $(date +%H:%M)." >&2
  exit 3
fi
case "$REPO/" in "$LIVE_DIR/"*) echo "Refusing: this is the live install ($REPO). The nightly check runs from the working folder only." >&2; exit 2 ;; esac
if [ "$PORT" = "4000" ] || [ "$PORT" = "4001" ] || [ "$FIX_PORT" = "4000" ] || [ "$FIX_PORT" = "4001" ]; then echo "Refusing: port $PORT is live (4000) or the shared dev server (4001)." >&2; exit 2; fi

mkdir -p "$OUT/screens" "$NH/tmp"
if ! mkdir "$NH/lock" 2>/dev/null; then
  if [ -f "$NH/lock/pid" ] && kill -0 "$(cat "$NH/lock/pid")" 2>/dev/null; then echo "Another nightly check is running (pid $(cat "$NH/lock/pid"))." >&2; exit 4; fi
  rm -rf "$NH/lock"; mkdir "$NH/lock"
fi
echo $$ > "$NH/lock/pid"
: > "$OUT/facts.tsv"
fact started "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
[ "$DRY" = 1 ] && fact dry 1
say "Nightly check $DATE from $REPO (port $PORT)$([ "$DRY" = 1 ] && echo ', DRY RUN')"

stop_server() {
  for pid in $(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null; done
  if [ -f "$NH/server.pid" ]; then kill "$(cat "$NH/server.pid")" 2>/dev/null; rm -f "$NH/server.pid"; fi
}
finish() {
  stop_server
  [ "$SKIP_SIM" = 1 ] || xcrun simctl shutdown all >/dev/null 2>&1
  rm -f "$NH/tmp/owner.token"
  rm -rf "$NH/lock"
}
trap finish EXIT

# Seconds, then the command; the command is stopped when it runs longer.
with_timeout() {
  local secs=$1; shift
  "$@" & local pid=$!
  ( sleep "$secs"; kill -TERM "$pid" 2>/dev/null; sleep 15; kill -KILL "$pid" 2>/dev/null ) >/dev/null 2>&1 & local watcher=$!
  wait "$pid"; local rc=$?
  kill "$watcher" 2>/dev/null; wait "$watcher" 2>/dev/null
  return $rc
}
# Age of a process in seconds (from ps etime: [[dd-]hh:]mm:ss).
age_of() { ps -o etime= -p "$1" 2>/dev/null | awk '{ n=split($1,a,/[-:]/); s=0; if(n==4) s=a[1]*86400+a[2]*3600+a[3]*60+a[4]; else if(n==3) s=a[1]*3600+a[2]*60+a[3]; else s=a[1]*60+a[2]; print s }'; }

# ── 2. Leftovers ──
stop_server
for pid in $(pgrep -f "$NH/" 2>/dev/null); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null && say "Stopped a leftover of an earlier nightly check (pid $pid)"; done
others=""
for pid in $(pgrep -f 'e2e/[^ ]*\.mjs|ms-playwright' 2>/dev/null); do
  age=$(age_of "$pid"); [ -z "$age" ] && continue
  if [ "$age" -gt 10800 ]; then kill "$pid" 2>/dev/null && say "Stopped a test left running for $((age / 3600)) hours (pid $pid)"
  else others="$others $pid"; fi
done
[ -n "$others" ] && say "Other test runs are going on (pids$others): left alone"
if ! pgrep -f 'e2e/iphone-safari\.mjs' >/dev/null 2>&1 && xcrun simctl list devices booted 2>/dev/null | grep -q Booted; then
  xcrun simctl shutdown all >/dev/null 2>&1 && say "Shut down an iOS Simulator left on"
fi

# ── 3. Tonight's code: the current finalize ──
if [ ! -e "$WT/.git" ]; then
  git -C "$REPO" worktree add --detach "$WT" "$REF" >>"$OUT/run.log" 2>&1 || { problem "could not check out $REF into $WT"; }
fi
git -C "$WT" checkout -q --detach "$REF" >>"$OUT/run.log" 2>&1 && git -C "$WT" reset -q --hard "$REF" && git -C "$WT" clean -qfd -e node_modules >>"$OUT/run.log" 2>&1
COMMIT="$(git -C "$WT" log -1 --format='%h %s' 2>/dev/null)"
[ "$REF" != "finalize" ] && COMMIT="$COMMIT (from $REF, not finalize)"
fact commit "$COMMIT"
say "$REF: $COMMIT"
for d in node_modules apps/portal/node_modules apps/web/node_modules packages/api/node_modules packages/shared/node_modules; do
  if [ -e "$REPO/$d" ] && [ ! -e "$WT/$d" ]; then ln -s "$REPO/$d" "$WT/$d"; fi
done
# Its settings: the working folder's dev settings, on its own port. Never the live ones.
envsrc="$REPO/apps/portal/.env"
sed -e "s/^PORT=.*/PORT=$PORT/" -e "s#^APP_URL=.*#APP_URL=\"http://localhost:$PORT\"#" -e 's/connection_limit=[0-9]*/connection_limit=4/' "$envsrc" > "$WT/apps/portal/.env"
grep -q 'connection_limit=' "$WT/apps/portal/.env" || say "Note: the dev DATABASE_URL has no connection_limit"
printf 'VITE_API_PORT=%s\n' "$PORT" > "$WT/apps/web/.env.local"
printf 'VITE_API_PORT=%s\n' "$PORT" > "$WT/apps/portal/.env.local"

# ── Safety: the dev copy, nothing outside ──
dburl="$(grep -E '^DATABASE_URL=' "$WT/apps/portal/.env" | head -1 | sed -E 's/^DATABASE_URL="?([^"]*)"?$/\1/')"
dbname="$(printf '%s' "$dburl" | sed -E 's#^[^/]*//[^/]*/([^?]*).*#\1#')"
if [ "$dbname" != "$DB" ]; then problem "the settings name the database \"$dbname\", not $DB: nothing was run"; fact finished "$(date -u +%Y-%m-%dT%H:%M:%SZ)"; (cd "$WT/apps/portal" && npx tsx scripts/nightly-report.ts --night "$OUT"); exit 1; fi
if grep -Eq ':4000|//[^/]*/ezbiz(\?|"|$)' "$WT/apps/portal/.env"; then problem "the settings mention port 4000 or the live database: nothing was run"; exit 1; fi
fact safety "Database: $DB (checked in the settings before anything ran); its own server on port $PORT, never 4000"
set_outside="$(grep -E '^(SMTP_HOST|SMTP_PASS|SENDGRID_API_KEY|TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN|GMAIL_CLIENT_SECRET|ZAPIER_[A-Z_]*|RETELL_API_KEY)=' "$WT/apps/portal/.env" | grep -Ev '=("")?$' | cut -d= -f1 | tr '\n' ' ')"
if [ -n "$set_outside" ]; then fact safety "Outside service settings that are not empty in the dev settings: $set_outside(the outbound gate holds them anyway)"; else fact safety "Email, text and other outside service settings: empty"; fi

# ── 4. Fresh practice data ──
if [ "$SKIP_REFRESH" = 1 ]; then
  fact refresh skipped "not refreshed ($([ "$DRY" = 1 ] && echo 'dry run' || echo '--skip-refresh')): tonight used the dev copy as it was"
else
  conns="$(psql -d postgres -Atc "select count(*) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid()" 2>/dev/null || echo '?')"
  if [ "$conns" != "0" ]; then
    fact refresh skipped "not refreshed: $conns other connections to $DB (the working folder's dev server on 4001, or another test, is using it); tonight used the dev copy as it was"
    say "Refresh skipped: $conns other connections to $DB"
  elif with_timeout 1800 bash "$WT/deploy/mac/refresh-dev-db.sh" >"$OUT/refresh.log" 2>&1; then
    fact refresh done "a fresh copy of live, scrubbed ($(grep -Eo 'Customers: [0-9]+' "$OUT/refresh.log" | tail -1))"
    say "Dev copy refreshed from live and scrubbed"
  else
    fact refresh failed "the refresh failed (see refresh.log): tonight used the dev copy as it was, if it is still there"
    problem "the dev refresh failed (refresh.log)"
  fi
fi
(cd "$WT/apps/portal" && pnpm exec prisma db push --skip-generate >"$OUT/schema.log" 2>&1) || say "prisma db push did not apply (schema.log): the dev copy has changes finalize does not; carrying on"
(cd "$WT/apps/portal" && pnpm exec prisma generate >>"$OUT/schema.log" 2>&1) || problem "prisma generate failed (schema.log)"

# The dev copy must be scrubbed and must not be able to reach a phone.
push="$(psql -d "$DB" -Atc 'select count(*) from "PushSubscription"' 2>/dev/null || echo '?')"
if [ "$push" != "0" ]; then
  say "The dev copy has $push phone push sign ups: scrubbing again"
  (cd "$WT/apps/portal" && npx tsx scripts/scrub-dev-db.ts >>"$OUT/refresh.log" 2>&1)
  push="$(psql -d "$DB" -Atc 'select count(*) from "PushSubscription"' 2>/dev/null || echo '?')"
fi
scrubbed="$(psql -d "$DB" -Atc "select count(*) from \"AccountKeyValue\" where key = 'dev:scrubbed'" 2>/dev/null || echo 0)"
gate="$(cd "$WT/apps/portal" && OUTBOUND_GATE=closed NODE_ENV=development npx tsx -e "import('./src/server/lib/outboundGate.ts').then(m => console.log(m.outboundBlockReason() || 'OPEN'))" 2>/dev/null | tail -1)"
SAFE=1
if [ "$push" != "0" ]; then problem "the dev copy still has $push phone push sign ups: the tests were not run"; SAFE=0; fi
if [ "${scrubbed:-0}" = "0" ]; then problem "the dev copy is not marked scrubbed (dev:scrubbed): the tests were not run"; SAFE=0; fi
if [ -z "$gate" ] || [ "$gate" = "OPEN" ]; then problem "the outbound gate would be open: the tests were not run"; SAFE=0; fi
fact safety "Phone push sign ups on the dev copy: ${push}; scrubbed mark: $([ "${scrubbed:-0}" != 0 ] && echo yes || echo NO)"
fact safety "Outbound gate: shut (${gate:-unknown})"

outbox="$WT/apps/portal/logs/dev-outbox.log"
held_before=$(wc -l < "$outbox" 2>/dev/null || echo 0)

# ── 5. Build, serve, test ──
if [ "$SAFE" = 1 ]; then
  say "Building the web app"
  if ! (cd "$WT/apps/web" && nice -n 10 pnpm -s build >"$OUT/build.log" 2>&1); then problem "the web app did not build (build.log)"; SAFE=0; fi
  (cd "$WT/apps/portal" && nice -n 10 pnpm -s build:client --base=/portal/ >>"$OUT/build.log" 2>&1) || say "the customer portal did not build (build.log)"
fi
if [ "$SAFE" = 1 ]; then
  say "Starting its server on $PORT"
  ( cd "$WT/apps/portal" && DISABLE_CRON=1 OUTBOUND_GATE=closed NODE_ENV=development PORT="$PORT" nice -n 10 ./node_modules/.bin/tsx src/server/index.ts 2>&1 | grep --line-buffered -v '^prisma:query' > "$OUT/server.log" ) &
  echo $! > "$NH/server.pid"
  up=0; for _ in $(seq 1 90); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && { up=1; break; }; sleep 1; done
  if [ "$up" != 1 ]; then problem "its server did not start (server.log)"; SAFE=0; fi
fi
if [ "$SAFE" = 1 ]; then
  (cd "$WT/apps/portal" && npx tsx scripts/dev-session-token.ts --email jbohdal@example.invalid --out "$NH/tmp/owner.token" --days 1 >>"$OUT/run.log" 2>&1) || problem "could not make the dev owner sign in (run.log)"
  say "The 3 job walkthrough"
  (cd "$WT/apps/web" && with_timeout 2700 env APP_URL="http://localhost:$PORT" API_URL="http://localhost:$PORT" E2E_ACCESS_TOKEN_FILE="$NH/tmp/owner.token" \
     SHOTS="$OUT/screens" RESULTS="$OUT/walkthrough.json" nice -n 10 node e2e/nightly-walkthrough.mjs >"$OUT/walkthrough.log" 2>&1)
  rc=$?
  fact suite walkthrough ran "$(tail -1 "$OUT/walkthrough.log" | tr -d '\n') (exit $rc; log: walkthrough.log)"
  if [ "$SKIP_SIM" = 1 ]; then
    fact suite iphone not "$([ "$DRY" = 1 ] && echo 'dry run' || echo '--skip-simulator'): the iOS Simulator was not started"
  else
    say "The iPhone run (Simulator)"
    (cd "$WT/apps/web" && with_timeout 3600 env APP_URL="http://localhost:$PORT" API_URL="http://localhost:$PORT" SHOTS="$OUT/screens" \
       MEDIA_PHOTO="$WT/apps/web/e2e/fixtures/test-photo.jpg" MEDIA_VIDEO="$WT/apps/web/e2e/fixtures/test-video.mp4" \
       nice -n 10 node e2e/iphone-safari.mjs >"$OUT/iphone.log" 2>&1)
    rc=$?
    xcrun simctl shutdown all >/dev/null 2>&1
    fact suite iphone ran "$(grep -E 'checks passed' "$OUT/iphone.log" | tail -1) (exit $rc; log: iphone.log; the Simulator was shut down after)"
  fi
else
  fact suite walkthrough not "not run: see the problems above"
  fact suite iphone not "not run: see the problems above"
fi
stop_server
held_after=$(wc -l < "$outbox" 2>/dev/null || echo 0)
fact outbox $((held_after - held_before))

# ── 6. New feedback, from live, read only ──
if [ -d "$FEEDBACK_DIR" ]; then
  case "$FEEDBACK_DIR" in "$LIVE_DIR"*) src="live (~/ezbiz, scripts/feedback-report.ts in a read-only transaction)" ;; *) src="$FEEDBACK_DIR (not live)" ;; esac
  fact feedback-source "$src"
  (cd "$FEEDBACK_DIR" && with_timeout 120 npx tsx scripts/feedback-report.ts --status new --json --limit 300 >"$OUT/feedback.jsonl" 2>"$OUT/feedback-error.txt")
  if [ $? -eq 0 ]; then : > "$OUT/feedback-error.txt"; fi
else
  fact feedback-source "nothing at $FEEDBACK_DIR"
  echo "the feedback folder $FEEDBACK_DIR does not exist" > "$OUT/feedback-error.txt"
fi

# ── 7. The report ──
fact finished "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
counts="$(cd "$WT/apps/portal" && npx tsx scripts/nightly-report.ts --night "$OUT" 2>>"$OUT/run.log" | tail -1)"
say "Report: $counts"
NEW=$(echo "$counts" | sed -nE 's/.*NEW_FAILURES=([0-9]+).*/\1/p'); NEW=${NEW:-0}
FRESH=$(echo "$counts" | sed -nE 's/.*FRESH_FEEDBACK=([0-9]+).*/\1/p'); FRESH=${FRESH:-0}

# ── 8. The night agent ──
if [ "$NEW" -gt 0 ] || [ "$FRESH" -gt 0 ]; then
  CLAUDE="${NIGHTLY_CLAUDE:-$(command -v claude 2>/dev/null)}"
  [ -z "$CLAUDE" ] && [ -x "$HOME/.claude/local/claude" ] && CLAUDE="$HOME/.claude/local/claude"
  [ -z "$CLAUDE" ] && CLAUDE="$(ls -d "$HOME"/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | sort -V | tail -1)"
  BRANCH="nightly-fix/$DATE"
  FIX="$NH/fix-$DATE"
  SUMMARY="$OUT/agent-summary.md"
  # Every Bash command it may run is listed; anything else is refused (nobody is there to ask).
  ALLOWED=(Read Glob Grep Edit Write TodoWrite
    'Bash(pnpm test)' 'Bash(pnpm test *)' 'Bash(pnpm -s build)' 'Bash(pnpm build)' 'Bash(pnpm exec tsc *)' 'Bash(pnpm exec vitest *)'
    'Bash(pnpm exec prisma generate)' 'Bash(pnpm exec tsx *)' 'Bash(npx tsx *)' 'Bash(npx vitest *)' 'Bash(nice -n 10 *)'
    'Bash(node e2e/*)' 'Bash(node --check *)' 'Bash(DISABLE_CRON=1 *)' 'Bash(APP_URL=* node e2e/*)' 'Bash(APP_URL=* nice -n 10 node e2e/*)'
    'Bash(git status*)' 'Bash(git diff*)' 'Bash(git log*)' 'Bash(git show*)' 'Bash(git add *)' 'Bash(git commit *)'
    'Bash(git branch --show-current)' 'Bash(git rev-parse *)' 'Bash(git restore *)'
    'Bash(ls *)' 'Bash(cat *)' 'Bash(head *)' 'Bash(tail *)' 'Bash(wc *)' 'Bash(grep *)' 'Bash(rg *)' 'Bash(find *)' 'Bash(sed -n *)'
    'Bash(curl -s http://localhost:*)' 'Bash(curl -fsS http://127.0.0.1:*)' 'Bash(lsof -ti *)' 'Bash(kill *)' 'Bash(sleep *)' 'Bash(mkdir *)'
    'Bash(psql -d ezbiz_dev *)')
  DENIED=('Bash(git push*)' 'Bash(git merge*)' 'Bash(git rebase*)' 'Bash(git reset --hard*)' 'Bash(git checkout main*)' 'Bash(git checkout finalize*)'
    'Bash(git worktree*)' 'Bash(git branch -D*)' 'Bash(*update.sh*)' 'Bash(pm2 *)' 'Bash(*/ezbiz/*)' 'Bash(*~/ezbiz*)' 'Bash(psql -d ezbiz *)' 'Bash(psql ezbiz*)'
    'Bash(*prisma db push*)' 'Bash(*refresh-dev-db*)' 'Bash(*launchctl*)' 'Bash(*nightly-check*)' WebFetch WebSearch)
  AGENT=(env GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=remote.origin.pushurl GIT_CONFIG_VALUE_0=file:///dev/null/the-night-agent-never-pushes
    GIT_CONFIG_KEY_1=push.default GIT_CONFIG_VALUE_1=nothing GIT_SSH_COMMAND=false GIT_TERMINAL_PROMPT=0
    "$CLAUDE" -p PROMPT --permission-mode acceptEdits --permission-prompts none --add-dir "$OUT"
    --max-budget-usd "${NIGHTLY_AGENT_BUDGET:-40}" -n "nightly-fix $DATE" --output-format text
    --allowedTools "${ALLOWED[@]}" --disallowedTools "${DENIED[@]}")
  # The command as words for the report (the prompt is the file agent-prompt.md).
  CMD="cd $(printf '%q' "$FIX") && "
  for x in "${AGENT[@]}"; do
    if [ "$x" = "PROMPT" ]; then CMD="$CMD\"\$(cat $(printf '%q' "$OUT/agent-prompt.md"))\" "; else CMD="$CMD$(printf '%q' "$x") "; fi
  done
  # The prompt, filled in.
  export P_DATE="$DATE" P_NIGHT="$OUT" P_REPORT="$OUT/report.md" P_WORKTREE="$FIX" P_BRANCH="$BRANCH" P_PORT="$FIX_PORT" P_SUMMARY="$SUMMARY" \
         P_TOKEN_FILE="$NH/tmp/agent-owner.token" P_NEW_FAILURES="$NEW" P_FRESH_FEEDBACK="$FRESH"
  perl -pe 's/\{\{(\w+)\}\}/exists $ENV{"P_$1"} ? $ENV{"P_$1"} : $&/ge' "$REPO/deploy/mac/nightly-fix-prompt.md" > "$OUT/agent-prompt.md"
  printf '%s\n' "$CMD" > "$OUT/agent-command.txt"
  if [ "$SKIP_AGENT" = 1 ]; then
    fact agent not - "$([ "$DRY" = 1 ] && echo 'dry run' || echo '--skip-agent'): the command it would run is below; its prompt is agent-prompt.md in this folder"
  elif [ -z "$CLAUDE" ] || [ ! -x "$CLAUDE" ]; then
    fact agent not - "the claude command was not found (set NIGHTLY_CLAUDE in the LaunchAgent)"
  else
    # Its worktree, on its own branch from finalize; the dev settings on its own port.
    if [ ! -d "$FIX" ]; then
      if git -C "$REPO" show-ref -q --verify "refs/heads/$BRANCH"; then git -C "$REPO" worktree add "$FIX" "$BRANCH" >>"$OUT/run.log" 2>&1
      else git -C "$REPO" worktree add -b "$BRANCH" "$FIX" "$REF" >>"$OUT/run.log" 2>&1; fi
    fi
    for d in node_modules apps/portal/node_modules apps/web/node_modules packages/api/node_modules packages/shared/node_modules; do
      if [ -e "$REPO/$d" ] && [ ! -e "$FIX/$d" ]; then ln -s "$REPO/$d" "$FIX/$d"; fi
    done
    sed -e "s/^PORT=.*/PORT=$FIX_PORT/" -e "s#^APP_URL=.*#APP_URL=\"http://localhost:$FIX_PORT\"#" "$WT/apps/portal/.env" > "$FIX/apps/portal/.env"
    printf 'VITE_API_PORT=%s\n' "$FIX_PORT" > "$FIX/apps/web/.env.local"
    printf 'VITE_API_PORT=%s\n' "$FIX_PORT" > "$FIX/apps/portal/.env.local"
    say "The night agent: $NEW new failures, $FRESH new feedback (branch $BRANCH)"
    PROMPT_TEXT="$(cat "$OUT/agent-prompt.md")"
    RUN=()
    for x in "${AGENT[@]}"; do if [ "$x" = "PROMPT" ]; then RUN+=("$PROMPT_TEXT"); else RUN+=("$x"); fi; done
    ( cd "$FIX" && with_timeout $(( ${NIGHTLY_AGENT_MINUTES:-240} * 60 )) "${RUN[@]}" ) >"$OUT/agent.log" 2>&1
    arc=$?
    # Its server, if it left one.
    for pid in $(lsof -ti "tcp:$FIX_PORT" -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null; done
    rm -f "$NH/tmp/agent-owner.token"
    commits="$(git -C "$REPO" rev-list --count "$REF..$BRANCH" 2>/dev/null || echo 0)"
    dirty="$(git -C "$FIX" status --porcelain 2>/dev/null | grep -v node_modules | head -1)"
    if [ "$commits" = "0" ] && [ -z "$dirty" ]; then
      git -C "$REPO" worktree remove --force "$FIX" >/dev/null 2>&1; git -C "$REPO" branch -D "$BRANCH" >/dev/null 2>&1
      words="no commits, so its branch was removed"
    elif [ -z "$dirty" ]; then
      git -C "$REPO" worktree remove --force "$FIX" >/dev/null 2>&1
      words="$commits commits on the branch $BRANCH (not pushed, not deployed)"
    else
      words="$commits commits on $BRANCH, and changes not committed left in $FIX"
    fi
    [ -s "$SUMMARY" ] || echo "The night agent wrote no summary (exit $arc; its log: agent.log). Needs Jonathan." > "$SUMMARY"
    fact agent ran "$arc" "It looked at $NEW new failures and $FRESH new feedback: $words."
  fi
  (cd "$WT/apps/portal" && npx tsx scripts/nightly-report.ts --night "$OUT" >/dev/null 2>>"$OUT/run.log")
fi

# ── Keep 30 nights ──
nights=()
while IFS= read -r n; do nights+=("$n"); done < <(ls -1 "$OUT_ROOT" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' | sort)
for ((i = 0; i < ${#nights[@]} - 30; i++)); do rm -rf "${OUT_ROOT:?}/${nights[$i]}"; say "Removed the report of ${nights[$i]} (30 nights are kept)"; done

say "Done: $OUT/report.md"
head -12 "$OUT/report.md" 2>/dev/null
exit 0
