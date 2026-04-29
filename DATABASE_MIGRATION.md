# Database Migration Plan
**Date:** 2026-04-28

The portal backend is already configured for **PostgreSQL** ([`apps/portal/prisma/schema.prisma:5-8`](apps/portal/prisma/schema.prisma#L5-L8)):

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

So the *engine* is correct. The risk is whether the **production `DATABASE_URL`** points to a managed, persistent Postgres host. This document is the runbook to confirm or fix that.

---

## Step 1 — Inspect the production DATABASE_URL

Log in to the hosting platform's environment-variable settings and read `DATABASE_URL`.

| Pattern | Verdict | Action |
|---|---|---|
| `postgresql://USER:PASS@HOST.aws.neon.tech/DB...`           | ✅ Neon — persistent | Done. |
| `postgresql://USER:PASS@db.HOST.supabase.co:5432/postgres`  | ✅ Supabase — persistent | Done. |
| `postgresql://USER:PASS@HOST.railway.app:PORT/DB`          | ✅ Railway managed PG plugin — persistent | Done. |
| `postgresql://USER:PASS@HOST.render.com/DB`                 | ✅ Render Postgres add-on — persistent | Done. |
| `postgresql://...localhost:5432/...` or `127.0.0.1`        | ❌ Will lose data if the app server restarts | Must migrate (Step 3). |
| `file:./dev.db` or anything starting with `file:`           | ❌ SQLite on ephemeral disk | Must migrate (Step 3). |
| Empty / unset                                               | ❌ App cannot persist anything | Must migrate (Step 3). |

The new startup validator ([`apps/portal/src/server/lib/urls.ts`](apps/portal/src/server/lib/urls.ts)) catches the last three cases and refuses to start in production.

---

## Step 2 — Verify persistence (sanity test on the running app)

```bash
# 1. Create a contact via the API
curl -s -X POST https://api.systemssyndicate.com/api/crm-contacts \
  -H "Authorization: Bearer $CRM_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Persist","lastName":"Test","email":"persist@test.invalid"}'

# 2. Note the returned id
# 3. Trigger a deploy / restart of the API server
# 4. Fetch the same record
curl -s https://api.systemssyndicate.com/api/crm-contacts \
  -H "Authorization: Bearer $CRM_ACCESS_TOKEN" | grep persist@test.invalid
```

If step 4 returns the record, persistence is confirmed. If it 404s or the row is missing, the database is on ephemeral storage — proceed to Step 3.

---

## Step 3 — Provision a managed Postgres (only if Step 1 or Step 2 failed)

**Recommended: Neon** (free tier, branching, generous limits).

1. Create a project at https://console.neon.tech
2. Copy the connection string (it includes `?sslmode=require`).
3. In your hosting platform's environment vars, set:
   ```
   DATABASE_URL=postgresql://...neon.tech/...?sslmode=require
   ```
4. Apply migrations:
   ```bash
   cd apps/portal
   npx prisma migrate deploy
   ```
5. (Optional) Seed:
   ```bash
   npx prisma db seed
   ```
6. Redeploy the application.

**Alternative providers** all work the same — set `DATABASE_URL`, run `migrate deploy`, redeploy:

- Render Postgres: dashboard → New → PostgreSQL → copy the External Database URL
- Railway: New project → Add Postgres plugin → copy `DATABASE_URL`
- Supabase: project settings → Database → Connection string (Direct)

---

## Step 4 — Migrating from SQLite to Postgres (only if Step 1 found `file:` URL)

Run from a machine that has both the old SQLite file and the new Postgres URL accessible:

```bash
# 1. Dump SQLite via Prisma to JSON
DATABASE_URL=file:./dev.db npx prisma migrate reset --skip-seed --force
# (regenerates schema in SQLite — ignore the data, we're going to dump and reimport)

# 2. Use sqlite3 to export each table:
sqlite3 dev.db -json 'SELECT * FROM "Customer";'    > customer.json
sqlite3 dev.db -json 'SELECT * FROM "CrmAccount";'  > crmaccount.json
# ...repeat for each table you care about

# 3. Apply schema to Postgres
DATABASE_URL=postgresql://...neon.tech/... npx prisma migrate deploy

# 4. Import each JSON file via a small Node script using prisma.<Model>.createMany({ data: ... })
```

A clean Prisma-to-Prisma copy script lives in `scripts/migrate-sqlite-to-postgres.ts` (TODO — not in this PR; instructions are sufficient until needed).

---

## Step 5 — Add the new `CrmContact` table

This PR introduces the `CrmContact` model ([prisma/schema.prisma — bottom](apps/portal/prisma/schema.prisma)). Apply it to whichever Postgres you're pointing at:

```bash
cd apps/portal
npx prisma migrate dev --name add_crm_contact   # local
# OR for production:
npx prisma migrate deploy
```

The migration is purely additive — no existing rows are touched.

---

## Rollback safety

- Every migration in this fix-pass is **additive**. No DROP / ALTER on existing columns.
- `CrmContact` is a brand-new table; reverting the migration just drops an empty table.
- `localStorage` continues to work as the primary read source after this PR; the database write is fire-and-forget. So if the API is unreachable, the user experience is unchanged.

---

## After-action

Once the production `DATABASE_URL` is confirmed correct:

1. Trigger `POST /api/crm-auth/invites/resend-all-pending` (admin auth required) to reissue every outstanding team-member invite. Each one will be sent through the new click-tracking-disabled email path so links land at `https://systemssyndicate.com/accept-invite?...` (not `url4845.www.systemssyndicate.com/...`).
2. Run the verification tests in [`CRITICAL_FIXES_VERIFICATION.md`](CRITICAL_FIXES_VERIFICATION.md).
