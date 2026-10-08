#!/bin/bash
# ── EZ Biz — Deploy Script ──
#
# Builds whatever commit is checked out in the repo folder and puts it live.
# It stops at the first problem and leaves the running site untouched:
#
#   1. back up the database           (stop if the backup fails)
#   2. install and build everything   (stop if anything fails to build)
#   3. check the database change      (stop if it would drop or alter data)
#   4. apply the database change      (additive only)
#   5. copy the built files into place
#   6. restart the server and check that it answers
#
# Usage on the server:
#   cd /var/www/fencepro/repo && git fetch origin && git checkout main && git pull
#   bash deploy/deploy.sh
#
# Escape hatches (use on purpose, never by habit):
#   SKIP_BACKUP=1                    first install on an empty database
#   ALLOW_DESTRUCTIVE_MIGRATION=1    a planned change that removes columns
#
# See GO_LIVE.md for the one time setup this script expects.

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/fencepro}"
REPO_DIR="${REPO_DIR:-$APP_DIR/repo}"
LIVE_ENV="$APP_DIR/portal/.env"
PORT="${PORT:-4000}"

step() { echo; echo "── $1"; }
die()  { echo; echo "DEPLOY STOPPED: $1" >&2; echo "Nothing live was changed after this point." >&2; exit 1; }

cd "$REPO_DIR" || die "repo folder $REPO_DIR not found"

echo "════════════════════════════════════════"
echo "  EZ Biz — deploying $(git rev-parse --short HEAD 2>/dev/null || echo '?') ($(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?'))"
echo "════════════════════════════════════════"

# ── 0. Settings file ──
# The live settings live outside the repo so a pull can never overwrite them.
if [ -f "$LIVE_ENV" ]; then
  cp "$LIVE_ENV" apps/portal/.env
elif [ -f apps/portal/.env ]; then
  echo "Note: using apps/portal/.env (no $LIVE_ENV yet). It will be copied there."
else
  die "no settings file. Create $LIVE_ENV from apps/portal/.env.example first (see GO_LIVE.md)."
fi

step "[1/6] Installing dependencies"
pnpm install --frozen-lockfile

step "[2/6] Backing up the database"
if [ "${SKIP_BACKUP:-0}" = "1" ]; then
  echo "SKIP_BACKUP=1 set, no backup taken."
else
  node --import tsx apps/portal/scripts/pre-deploy-backup.ts \
    || die "the database backup failed. Fix that first; a deploy without a backup is not worth the risk."
fi

step "[3/6] Building"
( cd apps/portal && npx prisma generate && pnpm build:server && pnpm build:client ) \
  || die "the server or portal did not build."
( cd apps/web && npx vite build ) \
  || die "the web app did not build."

step "[4/6] Database change"
( cd apps/portal && node --import tsx scripts/migration-safety-check.ts ) \
  || die "the database change would remove or alter existing data. Review it before going further."
# No --accept-data-loss: if Prisma thinks data would be lost it refuses, and so do we.
( cd apps/portal && npx prisma db push --skip-generate ) \
  || die "the database change was not applied."

step "[5/6] Copying files into place"
mkdir -p "$APP_DIR/web" "$APP_DIR/portal/dist" "$APP_DIR/portal/prisma" "$APP_DIR/portal/uploads"
rsync -a --delete apps/web/dist/      "$APP_DIR/web/"
rsync -a --delete apps/portal/dist/   "$APP_DIR/portal/dist/"
rsync -a --delete apps/portal/prisma/ "$APP_DIR/portal/prisma/"
cp apps/portal/package.json "$APP_DIR/portal/package.json"
if [ -f apps/portal/.pnpmfile.cjs ]; then cp apps/portal/.pnpmfile.cjs "$APP_DIR/portal/.pnpmfile.cjs"; fi
if [ ! -f "$LIVE_ENV" ]; then cp apps/portal/.env "$LIVE_ENV"; fi
( cd "$APP_DIR/portal" && pnpm install --prod )

step "[6/6] Restarting"
cd "$APP_DIR/portal"
# The process has gone by two names over time. Restart whichever exists.
PM2_NAME=""
for name in fencepro fencepro-portal; do
  if pm2 describe "$name" >/dev/null 2>&1; then PM2_NAME="$name"; break; fi
done
if [ -n "$PM2_NAME" ]; then
  pm2 restart "$PM2_NAME" --update-env
else
  PM2_NAME="fencepro"
  NODE_ENV=production pm2 start dist/server/index.js --name "$PM2_NAME" \
    --max-memory-restart 512M --log-date-format "YYYY-MM-DD HH:mm:ss"
fi
pm2 save

echo "Waiting for the server to answer..."
ok=0
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != "1" ]; then
  pm2 logs "$PM2_NAME" --lines 40 --nostream || true
  die "the server did not answer on port $PORT after the restart. The log above says why. The backup from step 2 is your way back."
fi

nginx -t && systemctl reload nginx

echo
echo "════════════════════════════════════════"
echo "  Deploy complete: $(cd "$REPO_DIR" && git rev-parse --short HEAD)"
echo "════════════════════════════════════════"
pm2 status
