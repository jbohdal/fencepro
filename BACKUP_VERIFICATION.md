# Backup System Verification
**Date:** 2026-04-29 (template — to be re-filled in after first deploy of this fix-pass)

This file is a *template* for the verification work that should be run **once, immediately after deploying** this fix-pass to production. Until those tests are run, every claim in `DATA_SAFETY_AUDIT.md` and `BACKUP_RESTORE_GUIDE.md` is theoretical. Once they pass, this file becomes the dated proof.

---

## Test 1 — Manual backup runs cleanly

**Goal:** prove `pg_dump` works against the production DB from the VPS.

```bash
ssh root@143.198.109.59
cd /var/www/fencepro/repo
node --import tsx apps/portal/scripts/backup-database.ts
```

| Pass criteria | Result |
|---|---|
| Exit code 0 | ☐ |
| `[backup] OK` line printed | ☐ |
| `/var/backups/ezbiz/backup_<timestamp>.sql.gz` exists and is > 100 KB | ☐ |
| Email summary sent to `ADMIN_ALERT_EMAIL` | ☐ (skip if no admin email set) |
| Row appears in `BackupLog` table | ☐ |

```bash
# Verify the BackupLog row
psql "$DATABASE_URL" -c 'SELECT "backupType","status","fileSizeBytes","completedAt" FROM "BackupLog" ORDER BY "completedAt" DESC LIMIT 5;'
```

---

## Test 2 — Backup is restorable (the most important test)

**Goal:** prove the dump file can actually be replayed onto a database. Failing to do this means no recovery is possible regardless of how many backups exist.

```bash
# 1. Note the current customer count
psql "$DATABASE_URL" -c 'SELECT COUNT(*) FROM "CrmContact";'
# (record the number)

# 2. Run restore against the same DB (idempotent — restores the same state)
node --import tsx apps/portal/scripts/restore-database.ts /var/backups/ezbiz/<file>.sql.gz
# - Confirm the script prints "Current row counts" before doing anything
# - Confirm it asks for "CONFIRM"
# - Type CONFIRM
# - Confirm it prints post-restore counts that match pre-restore counts
```

| Pass criteria | Result |
|---|---|
| Script asks for "CONFIRM" before proceeding | ☐ |
| Restore completes with no SQL errors | ☐ |
| Post-restore CrmContact count matches pre-restore | ☐ |
| `BackupLog` shows a `restore` row with `status=success` | ☐ |

Note: this is a *self-restore* (same data → same DB). For a true restore-to-different-DB test, provision a temporary DB, set `DATABASE_URL` to it, and restore there. That's the gold-standard test but requires a spare DB.

---

## Test 3 — Daily cron is registered

**Goal:** prove the in-process cron will fire at 06:00 UTC.

```bash
ssh root@143.198.109.59
pm2 logs fencepro --lines 100 --nostream | grep -i 'data-integrity\|cron'
```

Expected line: `[data-integrity] cron started (snapshot 06:00 UTC, backup-staleness 07:00 UTC)`

| Pass criteria | Result |
|---|---|
| `[data-integrity] cron started` appears in logs after the most recent restart | ☐ |

To test the snapshot logic without waiting until 06:00 UTC, run it manually:

```bash
node --import tsx -e "import('/var/www/fencepro/portal/dist/server/lib/dataIntegrityCron.js').then(m => m.recordDailySnapshot()).then(r => console.log(JSON.stringify(r, null, 2)))"
```

This inserts a row into `MonitoringSnapshot` for today.

---

## Test 4 — Health check reports backup info

```bash
curl -s https://www.systemssyndicate.com/api/health | python3 -m json.tool
```

| Pass criteria | Result |
|---|---|
| Top-level `status: "ok"` | ☐ |
| `database.customerCount` and `contactCount` are numbers | ☐ |
| `storage.lastBackupAt` is within the last 25 hours | ☐ |
| `storage.lastBackupSizeBytes` matches the file we just created | ☐ |

Then:

```bash
curl -s https://www.systemssyndicate.com/api/health/storage
```

Expected: `{"status":"ok","driver":"local","path":"./uploads"}`

---

## Test 5 — Pre-deployment backup blocks bad deploys

**Goal:** prove that if pg_dump fails, the deploy aborts.

```bash
# Temporarily break the script's view of the DB:
DATABASE_URL=postgres://invalid:invalid@127.0.0.1:1/none \
  node --import tsx apps/portal/scripts/pre-deploy-backup.ts
echo "Exit code: $?"
```

| Pass criteria | Result |
|---|---|
| Exit code is non-zero | ☐ |
| Stdout/stderr clearly says "DEPLOY MUST ABORT" | ☐ |
| No partial backup file with size 0 was left behind | ☐ |

(Run with the real DATABASE_URL afterward to leave a successful pre-deploy backup in place.)

---

## Test 6 — Audit log records a CrmContact change

**Goal:** prove every important change is logged.

```bash
# 1. Log into https://systemssyndicate.com as admin
# 2. Create a customer (any name)
# 3. Edit the same customer's phone number
# 4. Soft-delete (or "delete") the same customer

# Then check:
curl -s "https://www.systemssyndicate.com/api/admin/audit-log?entityType=CrmContact&limit=5" \
  -H "Authorization: Bearer <admin-token>" \
  | python3 -m json.tool
```

| Pass criteria | Result |
|---|---|
| Three rows visible with actions: `create`, `update`, `soft_delete` | ☐ |
| Each row's `oldValues` / `newValues` shows the change | ☐ |
| `userEmail` and `ipAddress` are populated | ☐ |
| Visible in Admin → 🛡️ Audit Log page in the UI | ☐ |
| CSV export downloads with the same rows | ☐ |

---

## Test 7 — Anomaly alert fires

**Goal:** prove the daily decrease-detector works.

```bash
# Insert two snapshots: yesterday with 10 customers, today with 4. Should trigger alert.
psql "$DATABASE_URL" <<'EOF'
INSERT INTO "MonitoringSnapshot" ("id","snapshotDate","customerCount","contactCount","quoteCount","jobCount","invoiceCount","paymentCount","documentCount","portalAccountCount","createdAt")
VALUES
  (gen_random_uuid(), NOW() - interval '1 day', 10, 0, 0, 0, 0, 0, 0, 0, NOW()),
  (gen_random_uuid(), NOW(), 4, 0, 0, 0, 0, 0, 0, 0, NOW())
ON CONFLICT ("snapshotDate") DO UPDATE SET "customerCount" = EXCLUDED."customerCount";
EOF

# Trigger the snapshot job manually
node --import tsx -e "import('/var/www/fencepro/portal/dist/server/lib/dataIntegrityCron.js').then(m => m.recordDailySnapshot())"
```

| Pass criteria | Result |
|---|---|
| Alert email arrives at `ADMIN_ALERT_EMAIL` with subject "ALERT — Unexpected data decrease detected in EZBiz" | ☐ |
| Email body lists "Customer count dropped from 10 to 4" | ☐ |

(Clean up by deleting those test snapshot rows.)

---

## Sign-off

When all seven tests show green checkmarks:

```
First verification run: ____________________ (date)
Verified by:            ____________________
Notes:                  ____________________
```

Save this filled-in copy alongside the rest of the docs.
