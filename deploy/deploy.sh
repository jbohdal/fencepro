#!/bin/bash
# ── FencePro CRM — Deploy Script ──
# Run this after setup.sh and after pushing code to the server
# Usage: bash deploy.sh

set -e

APP_DIR="/var/www/fencepro"
REPO_DIR="$APP_DIR/repo"

echo "════════════════════════════════════════"
echo "  FencePro CRM — Deploying"
echo "════════════════════════════════════════"

cd "$REPO_DIR"

# ── 1. Install dependencies ──
echo "[1/6] Installing dependencies..."
pnpm install

# ── 2. Build CRM web app ──
echo "[2/6] Building CRM web app..."
cd apps/web
npx vite build
cp -r dist/ "$APP_DIR/web/"
cd "$REPO_DIR"

# ── 3. Build Portal ──
echo "[3/6] Building Portal..."
cd apps/portal
npx prisma generate
npx tsc -p tsconfig.server.json || true
npx vite build
cd "$REPO_DIR"

# ── 4. Run database migrations ──
echo "[4/6] Syncing database..."
cd apps/portal
npx prisma db push --accept-data-loss || true
cd "$REPO_DIR"

# ── 5. Copy portal files ──
echo "[5/6] Deploying portal..."
mkdir -p "$APP_DIR/portal"
cp -r apps/portal/dist/ "$APP_DIR/portal/dist/"
cp -r apps/portal/prisma/ "$APP_DIR/portal/prisma/"
cp apps/portal/package.json "$APP_DIR/portal/"
cp -r node_modules/ "$APP_DIR/portal/node_modules/" 2>/dev/null || true
mkdir -p "$APP_DIR/portal/uploads"

# ── 6. Restart services ──
echo "[6/6] Restarting services..."
cd "$APP_DIR/portal"

# Stop existing PM2 process if running
pm2 delete fencepro-portal 2>/dev/null || true

# Start with PM2
pm2 start dist/server/index.js --name fencepro-portal \
  --env production \
  --max-memory-restart 512M \
  --log-date-format "YYYY-MM-DD HH:mm:ss"

pm2 save

# Reload nginx
nginx -t && systemctl reload nginx

echo ""
echo "════════════════════════════════════════"
echo "  Deploy complete!"
echo "════════════════════════════════════════"
echo ""
echo "  CRM:    https://systemssyndicate.com"
echo "  Portal: https://systemssyndicate.com/portal/"
echo "  API:    https://systemssyndicate.com/api/health"
echo ""
pm2 status
