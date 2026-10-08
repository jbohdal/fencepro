#!/bin/bash
# Bring the live copy (~/ezbiz) up to date with main on GitHub and restart.
# Takes a backup first. Stops at the first problem.
set -euo pipefail
cd "$(dirname "$0")/../.."

bash deploy/mac/backup.sh
git pull --ff-only origin main
pnpm install --frozen-lockfile
( cd apps/portal
  pnpm exec prisma generate
  pnpm test
  pnpm build:server
  pnpm build:client --base=/portal/
  # Refuses a change that would drop data instead of applying it.
  pnpm exec prisma db push --skip-generate )
( cd apps/web && pnpm build )
pm2 restart ezbiz --update-env || pm2 start deploy/mac/ecosystem.config.cjs
pm2 save

for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1; then echo "EZ Biz is up."; exit 0; fi
  sleep 1
done
echo "The server did not answer. See: pm2 logs ezbiz --lines 50" >&2
exit 1
