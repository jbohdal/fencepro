# Deployment Checklist
**Date:** 2026-04-29
**Scope:** Make all the work from recent prompts visible at https://www.systemssyndicate.com.

This is a one-time catch-up deployment plus a reusable per-deploy checklist. Run **all** of Section A once, then Section B every time you deploy in the future.

---

## A. One-time catch-up to ship the working tree

### A.1 — Review and commit the working tree (local machine)

The working tree has 27 modified files + 9 new files that are not in git history yet. Review with:

```bash
cd /Users/jonathanbohdal/Downloads/fencepro
git status --short
git diff --stat                                        # quick byte-level summary
git diff apps/web/src/App.tsx                          # the wiring change
git diff apps/portal/src/server/routes/crm-auth.ts     # the email + URL fixes
git diff apps/portal/src/server/lib/emailService.ts    # SendGrid click-tracking off
```

When happy, commit. Suggested split into logical chunks (or a single bundled commit — your call):

```bash
git add apps/portal/prisma/schema.prisma \
        apps/portal/src/server/lib/urls.ts \
        apps/portal/src/server/lib/emailService.ts \
        apps/portal/src/server/routes/crm-auth.ts \
        apps/portal/src/server/routes/portal.ts \
        apps/portal/src/server/routes/crm-contacts.ts \
        apps/portal/src/server/index.ts \
        apps/web/src/crmContactsApi.ts \
        apps/web/src/CustomersPage.tsx
git commit -m "Fix invite URL (SendGrid click-tracking off) + database-backed contacts"

git add apps/web/src/SalesPipelineBoard.tsx \
        apps/web/src/OperationsBoard.tsx \
        apps/web/src/JobsPage.tsx \
        apps/web/src/OperationsPage.tsx \
        apps/web/src/App.tsx
git commit -m "Vertical-swimlane redesign for Sales Pipeline + Operations boards"

# Remaining modified files (Login, Customer*Tab, etc.) — review individually:
git add -p <file>
git commit
```

Then push:

```bash
git push origin main
```

### A.2 — Provision the new database table

The new `CrmContact` model needs a migration. **First time only**, generate the migration locally to lock it into the migrations history:

```bash
cd apps/portal
npx prisma migrate dev --name add_crm_contact
# → creates prisma/migrations/<timestamp>_add_crm_contact/migration.sql
git add prisma/migrations
git commit -m "Add CrmContact migration"
git push
```

If `migrate dev` complains that the dev DB is out of sync, run `npx prisma migrate resolve --applied <migration_name>` for any older drift, then retry.

### A.3 — Deploy to the VPS

(Adjust paths to match your actual deploy layout.)

```bash
ssh user@systemssyndicate.com
cd /opt/ezbiz   # or wherever the app is checked out

# Pull the new code
git pull origin main

# Install any new deps (none added in this fix-pass, but always safe)
pnpm install --frozen-lockfile

# Apply the new migration to production
cd apps/portal
npx prisma migrate deploy
# → expected output: "Applying migration `<timestamp>_add_crm_contact`"
#                    "All migrations have been successfully applied."
npx prisma generate

# Build everything
cd ../..
pnpm --filter web build       # → apps/web/dist
pnpm --filter portal build:server   # → apps/portal/dist/server
```

### A.4 — Confirm env vars match what the new validator needs

```bash
# On the VPS:
sudo systemctl edit ezbiz-portal --full   # or wherever the env vars live
# OR if using a .env file:
cat /opt/ezbiz/apps/portal/.env | grep -E '^(APP_URL|CLIENT_URL|DATABASE_URL|JWT_SECRET|JWT_REFRESH_SECRET|SENDGRID_API_KEY|SENDGRID_FROM_EMAIL|NODE_ENV)='
```

Required values (see [ENVIRONMENT_FIXES.md](ENVIRONMENT_FIXES.md)):

```
APP_URL=https://systemssyndicate.com
CLIENT_URL=https://systemssyndicate.com
DATABASE_URL=postgresql://USER:PASS@HOST:5432/DB?sslmode=require
JWT_SECRET=<64+ random chars>
JWT_REFRESH_SECRET=<different 64+ random chars>
SENDGRID_API_KEY=SG.xxxxx
SENDGRID_FROM_EMAIL=noreply@systemssyndicate.com
NODE_ENV=production
```

### A.5 — Restart the API + reload nginx

```bash
sudo systemctl restart ezbiz-portal
# wait 2-3 seconds
sudo systemctl status ezbiz-portal --no-pager | head -20
journalctl -u ezbiz-portal -n 30 --no-pager | grep -E '\[env\]|🚀|Error|error'
```

Expected log output:
```
[env] ✅ All required environment variables look good.
🚀 EZBiz Portal API running on port 4000
   CORS origin: https://systemssyndicate.com
   Environment: production
```

If you see `[env] ❌ CRITICAL`, fix the listed variable and restart again.

```bash
# Frontend dist is just static files — nginx picks up changes immediately.
# But if nginx config is using sendfile/aio caching, reload it:
sudo nginx -t && sudo systemctl reload nginx
```

### A.6 — Resend broken team-member invites

After A.3–A.5, fire the new admin endpoint to reissue every outstanding `status='invited'` user with a working URL:

```bash
# Get an admin access token first (log in as Jonathan, copy from devtools localStorage.crm_access_token)
TOKEN="<paste here>"
curl -X POST https://www.systemssyndicate.com/api/crm-auth/invites/resend-all-pending \
     -H "Authorization: Bearer $TOKEN"
# → { "success": true, "data": { "totalPending": N, "sent": N, "failed": 0 } }
```

Server logs will print `[CRM Auth] ✉️ Reissued invite to <email>` for each one.

### A.7 — Run the post-deploy verification (Phase B below)

---

## B. Per-deploy checklist (every future deploy)

Use this for all subsequent code changes after the catch-up.

### Pre-deploy

- [ ] `pnpm --filter web typecheck && pnpm --filter portal typecheck` — both clean
- [ ] `pnpm --filter web build && pnpm --filter portal build:server` — both succeed
- [ ] Any new Prisma migrations are committed under `apps/portal/prisma/migrations/`
- [ ] Any new env vars are documented in `ENVIRONMENT_FIXES.md` and added to the production env

### Deploy

- [ ] `git push origin main` (or merge PR)
- [ ] `ssh` to VPS and `git pull`
- [ ] `pnpm install --frozen-lockfile`
- [ ] `cd apps/portal && npx prisma migrate deploy && npx prisma generate`
- [ ] `pnpm --filter web build`
- [ ] `pnpm --filter portal build:server`
- [ ] `sudo systemctl restart ezbiz-portal`
- [ ] Confirm `[env] ✅ All required environment variables look good.` in logs
- [ ] Confirm `/api/health` returns `{"status":"ok","db":"connected"}`
- [ ] If using a CDN: purge cache (none today)

### Post-deploy verification

Run these sanity checks every time:

```bash
# 1. Page loads + new title shipped
curl -sI https://www.systemssyndicate.com/ | head -5
curl -s https://www.systemssyndicate.com/ | grep -E '<title>|index-[A-Za-z0-9]+\.js' | head -3

# 2. New JS bundle hash (proves Vite output is fresh)
# 3. Login still works
curl -s -X POST https://www.systemssyndicate.com/api/crm-auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"jonathan@systemssyndicate.com","password":"GDFence2026!"}' \
     | head -c 200

# 4. New endpoints reachable
curl -s -o /dev/null -w "%{http_code}\n" https://www.systemssyndicate.com/api/crm-contacts
# (401 expected without auth — NOT 404)

# 5. Health check
curl -s https://www.systemssyndicate.com/api/health
# → {"status":"ok","db":"connected","timestamp":"..."}
```

Then a manual UX pass:

- [ ] Visit https://www.systemssyndicate.com — `<title>` says "EZBiz" (or whatever the rename target is)
- [ ] Log in as admin — sidebar shows "EZBiz" branding
- [ ] Sales Pipeline — vertical swimlanes, no horizontal scroll
- [ ] Operations — vertical swimlanes including Unscheduled lane
- [ ] Mobile view (devtools 390×844) — accordion layout, FAB visible, stage pills visible
- [ ] Send a test team-member invite — email arrives with `https://systemssyndicate.com/accept-invite?token=…` (no `urlNNNN.` prefix)
- [ ] Click the activation link — no SSL error
- [ ] Create a test customer — appears in list, survives `localStorage.clear()` *if* you also re-fetch from `/api/crm-contacts`

### If anything fails

1. Check `journalctl -u ezbiz-portal -n 100` for backend errors.
2. Check the browser devtools Network tab for failing API calls.
3. Roll back: `git revert <bad-commit>`, repeat A.3–A.5.

---

## What this checklist does NOT cover

- **Cloudflare / S3 / CDN setup.** Today this is a self-hosted nginx box — when migrating to a CDN later, add cache-purge steps here.
- **Database backups.** Should be automated outside this checklist (cron `pg_dump`, Neon snapshots, etc.).
- **Rotating JWT secrets.** Doing so invalidates every active session; treat as a separate incident-response runbook.
- **Migrating remaining localStorage entities** (quotes, jobs, invoices, vendors, settings) to the database. Each is its own PR following the [DATA_STORAGE_ARCHITECTURE.md §5 playbook](DATA_STORAGE_ARCHITECTURE.md#5-migration-playbook-per-entity).
