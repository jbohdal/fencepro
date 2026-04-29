# Safe Deployment Checklist
**Use this for every code deployment to systemssyndicate.com.** Updated 2026-04-29.

This supersedes `DEPLOYMENT_CHECKLIST.md` from the prior fix-pass. The new step is **Step 1 — pre-deploy backup**.

---

## Before every deployment

- [ ] **(1) Run pre-deployment database backup**
  ```bash
  ssh root@143.198.109.59
  cd /var/www/fencepro/repo
  node --import tsx apps/portal/scripts/pre-deploy-backup.ts
  ```
  Confirm the output ends with `[pre-deploy-backup] OK — /var/backups/ezbiz/pre-deploy_…sql.gz`. If it fails, **DO NOT DEPLOY** until the backup issue is resolved.

- [ ] **(2) Note the backup file name**
  Write it down. If anything goes wrong in steps 3–10 you'll restore from this file.

- [ ] **(3) Review the schema diff** (if any DB changes)
  ```bash
  cd /var/www/fencepro/repo/apps/portal
  node --import tsx scripts/migration-safety-check.ts
  ```
  If it reports `❌ DESTRUCTIVE OPERATIONS DETECTED`, stop. Schedule the destructive migration as a separate, planned change with explicit `ALLOW_DESTRUCTIVE_MIGRATION=1` after confirming the backup.

- [ ] **(4) Confirm env vars haven't changed**
  ```bash
  diff <(cut -d= -f1 /var/www/fencepro/portal/.env | sort) <(cut -d= -f1 /var/www/fencepro/repo/apps/portal/.env.example | sort) | head
  ```
  Anything that's in `.env.example` but not in your `.env` may need to be added.

- [ ] **(5) Confirm DigitalOcean automatic backups are still on**
  Spot-check: https://cloud.digitalocean.com/databases → `fencepro-db` → Backups. Most recent should be < 24h old.

## During deployment

- [ ] **(6) Pull and build**
  ```bash
  cd /var/www/fencepro/repo
  git pull origin main
  pnpm install --frozen-lockfile
  cp /var/www/fencepro/portal/.env apps/portal/.env
  ```

- [ ] **(7) Apply schema if needed (additive only without --accept-data-loss)**
  ```bash
  cd apps/portal
  npx prisma db push --skip-generate
  npx prisma generate
  cd ../..
  ```
  Watch the output. If it says it would drop or alter columns, **abort** — it's a destructive change that wasn't caught by the migration safety check.

- [ ] **(8) Build**
  ```bash
  cd apps/portal && pnpm build:server && cd ../..
  pnpm --filter web build
  ```
  Both must complete with no errors.

- [ ] **(9) Sync built artifacts into deploy dirs**
  ```bash
  rsync -av --delete apps/web/dist/ /var/www/fencepro/web/
  rsync -av --delete apps/portal/dist/    /var/www/fencepro/portal/dist/
  rsync -av --delete apps/portal/prisma/  /var/www/fencepro/portal/prisma/
  cp apps/portal/package.json /var/www/fencepro/portal/package.json
  cd /var/www/fencepro/portal && pnpm install --prod && cd /var/www/fencepro
  ```

- [ ] **(10) Restart with graceful shutdown**
  ```bash
  pm2 restart fencepro
  sleep 5
  pm2 logs fencepro --lines 30 --nostream
  ```
  Look for:
  - `[env] ✅ All required environment variables look good.`
  - `🚀 EZBiz Portal API running on port 4000`
  - `[data-integrity] cron started`

  No `[shutdown]` errors. No `Error:` lines in fresh output.

## After every deployment

- [ ] **(11) Confirm the page loads**
  ```bash
  curl -sI https://www.systemssyndicate.com/ | grep Last-Modified
  curl -s https://www.systemssyndicate.com/ | grep -oE 'index-[A-Za-z0-9]+\.js' | head -1
  ```
  `Last-Modified` should be today and the JS bundle hash should be different from the previous deploy.

- [ ] **(12) Confirm authentication works**
  Open https://www.systemssyndicate.com in **incognito**, log in. The dashboard should load.

- [ ] **(13) Confirm storage is healthy**
  ```bash
  curl https://www.systemssyndicate.com/api/health/storage
  ```
  Expect `{"status":"ok","driver":"local","path":"./uploads"}` or similar.

- [ ] **(14) Confirm DB + counts look right**
  ```bash
  curl -s https://www.systemssyndicate.com/api/health | python3 -m json.tool
  ```
  Look at the `database` block. `customerCount`, `contactCount`, `invoiceCount` should match what you expect (compare to yesterday's snapshot via `/api/admin/monitoring`).

- [ ] **(15) Smoke-test a save**
  Create a test customer and verify it appears in the list. Hard-refresh and confirm it persists.

- [ ] **(16) Confirm an existing customer still exists**
  Open a real customer record from before the deploy. All fields should still be there.

- [ ] **(17) Send a test invite**
  Admin → Team → Invite a test email. Confirm the email arrives with a link to `https://systemssyndicate.com/accept-invite?…` (no `urlNNNN` prefix).

- [ ] **(18) Watch the error logs for 5 minutes**
  ```bash
  pm2 logs fencepro --lines 0
  ```
  Live tail. Anything red is investigated.

## If anything fails — rollback

1. Identify the pre-deploy backup file from step 2.
2. Run:
   ```bash
   cd /var/www/fencepro/repo
   node --import tsx apps/portal/scripts/restore-database.ts /var/backups/ezbiz/pre-deploy_<TIMESTAMP>.sql.gz
   ```
3. Type `CONFIRM`.
4. If the deploy itself broke (not the data), revert the code:
   ```bash
   cd /var/www/fencepro/repo
   git log --oneline -5  # find the commit BEFORE the bad deploy
   git checkout <good-sha>
   pnpm install --frozen-lockfile
   pnpm --filter web build
   cd apps/portal && pnpm build:server && cd ../..
   rsync -av --delete apps/web/dist/ /var/www/fencepro/web/
   rsync -av --delete apps/portal/dist/ /var/www/fencepro/portal/dist/
   pm2 restart fencepro
   ```
5. After service is restored, run `git checkout main` again so the working tree reflects current state.

---

## What changed vs. the old DEPLOYMENT_CHECKLIST.md

| | Old | New |
|---|---|---|
| Pre-deploy backup | optional / manual | **mandatory step 1**, deploy aborts on failure |
| Migration safety check | none | `migration-safety-check.ts` blocks destructive auto-migrations |
| Graceful shutdown | pm2 hard-killed | SIGTERM/SIGINT drain in-flight requests up to 30s |
| `/api/health` | `{ status, db }` only | full database counts + storage + last-backup info |
| `/api/health/storage` | didn't exist | round-trip write test |
| Audit log | didn't exist | every CRM-side mutation recorded with before/after |
