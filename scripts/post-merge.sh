#!/bin/bash
set -e

echo "[post-merge] Installing dependencies..."
COREPACK_ENABLE_STRICT=0 pnpm install --dir apps/portal
COREPACK_ENABLE_STRICT=0 pnpm install --dir apps/web

echo "[post-merge] Generating Prisma client..."
cd apps/portal
COREPACK_ENABLE_STRICT=0 pnpm exec prisma generate
cd ../..

echo "[post-merge] Pushing database schema..."
cd apps/portal
DATABASE_URL="$DATABASE_URL" COREPACK_ENABLE_STRICT=0 pnpm exec prisma db push --skip-generate --accept-data-loss
cd ../..

echo "[post-merge] Done."
