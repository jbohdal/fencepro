# Backup & Restore Guide
**Audience:** the business owner or any team member, in plain English. Updated 2026-04-29.

EZBiz has **three independent backup layers** — each one protects you against a different kind of failure. You can lose any one of them and still have two more.

---

## Layer 1 — DigitalOcean Managed Database backups (automatic)

What it is: DigitalOcean automatically backs up your PostgreSQL database every day. You don't have to do anything for this to keep running.

| | |
|---|---|
| Provider | DigitalOcean Managed Databases |
| Console | https://cloud.digitalocean.com/databases |
| Default retention | 7 days |
| Cost | included in your existing database plan |

### How to verify backups are running

1. Sign in at https://cloud.digitalocean.com
2. **Databases** → click `fencepro-db`
3. **Backups** tab
4. You should see a list of dated backups, with the most recent one being from within the last 24 hours.
5. If the list is empty or the latest is more than 24 hours old, contact DigitalOcean support.

### How to restore from a DigitalOcean backup

1. **Databases** → `fencepro-db` → **Backups** tab
2. Click **Restore** next to the backup date you want
3. DigitalOcean creates a *new database cluster* from that backup (the original is left untouched). It takes 5–15 minutes.
4. When the new cluster is ready, copy its connection string.
5. SSH to the VPS: `ssh root@143.198.109.59`
6. Edit `/var/www/fencepro/portal/.env` and replace the `DATABASE_URL=` line with the new connection string.
7. `pm2 restart fencepro`
8. Verify the data looks correct at https://systemssyndicate.com.
9. Once you're satisfied, delete the OLD database cluster from DigitalOcean to stop double-billing.

---

## Layer 2 — Daily script-based backup (custom)

What it is: A nightly script runs on the VPS at 06:00 UTC, takes a `pg_dump` of the entire database, compresses it to a `.sql.gz` file, and stores it under `/var/backups/ezbiz/`. Last 30 days are retained.

| | |
|---|---|
| Script | `apps/portal/scripts/backup-database.ts` |
| Local storage | `/var/backups/ezbiz/backup_YYYY-MM-DD_HH-MM-SS.sql.gz` |
| Retention | 30 days (configurable via `BACKUP_RETENTION_DAYS`) |
| Schedule | runs in the API process at 06:00 UTC daily; also runnable manually |
| Optional off-site | uploads to S3 / DigitalOcean Spaces if `AWS_S3_BACKUP_BUCKET` is set |

### How to verify the daily backup ran

Option A — check the API health endpoint (easiest):
```
https://www.systemssyndicate.com/api/health
```
Look at the `storage` block. `lastBackupAt` should be from within the last 24–25 hours.

Option B — check the Admin → Audit Log → "Backups" tab.

Option C — SSH into the VPS:
```bash
ls -lh /var/backups/ezbiz/ | tail -10
```
You should see `backup_YYYY-MM-DD_06-00-XX.sql.gz` files growing daily.

### How to run the daily backup manually (any time)

From your laptop:

```bash
ssh root@143.198.109.59
cd /var/www/fencepro/repo
node --import tsx apps/portal/scripts/backup-database.ts
```

You'll see output like `[backup] OK — local file /var/backups/ezbiz/backup_2026-04-29_22-50-15.sql.gz, 0 old backups pruned (retention 30d)`.

### Where the email summary goes

If `ADMIN_ALERT_EMAIL` (or `SMTP_FROM_EMAIL`) is set in the portal `.env`, every backup sends a one-line summary email. If a backup *fails*, you get an alert email instead, immediately.

---

## Layer 3 — Pre-deployment backup (your safety net before any code change)

What it is: Before *any* code change is deployed to the live site, a fresh backup runs first. The deploy is aborted if the backup fails. This means you always have a clean snapshot from the moment just before any change was made.

| | |
|---|---|
| Script | `apps/portal/scripts/pre-deploy-backup.ts` |
| Local storage | `/var/backups/ezbiz/pre-deploy_YYYY-MM-DD_HH-MM-SS.sql.gz` |
| When it runs | step 1 of every deploy in `SAFE_DEPLOYMENT_CHECKLIST.md` |

You don't need to run this manually — your developer (or your future deploy script) does. But the backup files live in the same `/var/backups/ezbiz/` folder so you can list them with the `ls` command above.

---

## Restoring from a backup — full procedure

If the worst happens — wrong data deleted, bad migration, anything — restore from any of the three layers above. Here's the procedure for **layer 2 / 3** (your script-based backups). For layer 1, see "How to restore from a DigitalOcean backup" above.

### Before you restore — read this first

⚠️ **Restoring overwrites the current database.** Anything written *after* the backup time will be lost. So:

1. Identify *exactly* when the bad event happened.
2. Pick the most recent backup that was taken *before* the bad event.
3. The script will show you the row counts before AND after the restore, so you can sanity-check.

If you're not sure which backup to pick, restore the most recent one — it'll have the most data, even if it includes some of the bad changes.

### Procedure

1. SSH to the VPS:
   ```bash
   ssh root@143.198.109.59
   ```

2. List available backups:
   ```bash
   ls -lh /var/backups/ezbiz/ | tail -20
   ```

3. Pick the file you want and run the restore script:
   ```bash
   cd /var/www/fencepro/repo
   node --import tsx apps/portal/scripts/restore-database.ts /var/backups/ezbiz/backup_2026-04-29_06-00-15.sql.gz
   ```

4. The script will print:
   - The current row counts of key tables
   - A `⚠️ WARNING` block
   - A prompt: `Confirmation:`

5. Type the literal word `CONFIRM` (uppercase) and Enter. **Anything else aborts.**

6. The script applies the dump (takes 30 seconds to a few minutes depending on size) and prints the new row counts so you can verify.

7. Open https://systemssyndicate.com and click around to confirm the data looks right.

8. If it doesn't look right, restore from a different backup. (You can restore as many times as you want; each restore overwrites the last.)

### Restoring from S3 / DO Spaces (off-site)

If `AWS_S3_BACKUP_BUCKET` is configured and the local file is missing, you can restore directly from the cloud:

```bash
node --import tsx apps/portal/scripts/restore-database.ts s3://your-bucket/database-backups/backup_2026-04-29_06-00-15.sql.gz
```

The script downloads, decompresses, and applies it the same way.

---

## Common questions

**Will restoring break the running app?**
The app keeps running, but for a few seconds during the restore some queries may fail. Users who happen to be saving exactly during that window may need to retry. After the restore completes, the app behaves normally — just with the older data.

**Can I restore just one customer instead of the whole database?**
Yes, but it requires manual SQL. Your developer can do this by extracting the relevant rows from the dump file and running `INSERT` statements. See `DISASTER_RECOVERY_RUNBOOK.md` Scenario 5.

**How big are the backup files?**
A few hundred KB to a few MB while the database is small. Will grow proportionally as you add data.

**How long are backups kept?**
30 days locally. 7 days in DigitalOcean's automatic system (extendable by upgrading your DB plan). 90 days in S3 if configured (then moved to Glacier for an additional 270 days).

**Has a restore been tested?**
A first restore test should be done immediately after the next deploy that includes this fix-pass. See `BACKUP_VERIFICATION.md` for the test procedure.
