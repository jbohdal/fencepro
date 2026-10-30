#!/bin/bash
# Bring the live copy (~/ezbiz) up to date with main on GitHub and restart.
# Takes a backup first. Stops at the first problem.
set -euo pipefail
cd "$(dirname "$0")/../.."

# A stopped update tells the owner's phone: a "failed" Messages from Code (scripts/code-message.ts,
# owner only; only the live install's push reaches a phone). Never changes how the update ends.
# The live message ("what is live") is Code's to send once it has checked the app (GO_LIVE.md, section 21).
STEP="the backup"
tell_owner_if_failed() {
  local code=$?
  if [ "$code" != 0 ]; then
    ( cd apps/portal && pnpm exec tsx scripts/code-message.ts --kind failed \
        --title "Update of live stopped at $STEP. Details in the app." \
        --body "The update (deploy/mac/update.sh) stopped at $STEP (exit $code).
Code now: $(git log -1 --format='%h %s' 2>/dev/null || echo unknown)

Look: pm2 logs ezbiz --lines 50, and the update's own output.
A backup was taken first (~/ezbiz-backups) if the backup step passed." ) >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap tell_owner_if_failed EXIT

EZBIZ_BACKUP_TYPE=pre-deploy bash deploy/mac/backup.sh
STEP="getting the code (git pull)"
git pull --ff-only origin main
STEP="installing packages"
pnpm install --frozen-lockfile
STEP="the tests or the build"
( cd apps/portal
  pnpm exec prisma generate
  pnpm test
  pnpm build:server
  pnpm build:client --base=/portal/
  # Refuses a change that would drop data instead of applying it.
  pnpm exec prisma db push --skip-generate )
STEP="building the web app"
( cd apps/web && pnpm build )
# Start it again from the process file: a plain restart keeps pm2's old copy of the settings
# (Oct 23, 2026: the 2G memory limit only took effect after delete + start). The server finishes
# requests in flight before it exits (kill_timeout).
STEP="restarting the server"
pm2 delete ezbiz >/dev/null 2>&1 || true
pm2 start deploy/mac/ecosystem.config.cjs
pm2 save

STEP="the server answering after the restart"
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1; then echo "EZ Biz is up."; exit 0; fi
  sleep 1
done
echo "The server did not answer. See: pm2 logs ezbiz --lines 50" >&2
exit 1
