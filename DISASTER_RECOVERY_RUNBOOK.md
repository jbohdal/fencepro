# Disaster Recovery Runbook
**For:** the business owner or any team member, in plain English. Updated 2026-04-29.

This runbook covers the five most likely "something is wrong with my data" situations and how to recover in each. Read each scenario top-to-bottom before doing anything destructive.

When in doubt, **stop and read** before acting. The most common way data is lost permanently is from a panicked attempt to fix the first problem.

---

## Scenario 1 — A customer record is missing after a deployment

**What it feels like:** "I added a customer last week and now they're not showing up."

### Steps

1. **Don't add the customer again yet.** First confirm whether it's a display issue or a data issue.
2. **Log in** at https://www.systemssyndicate.com.
3. Open the **Audit Log** (Admin section in the sidebar, "🛡️ Audit Log").
4. In the **User** filter, type the customer's first name. In the **Entity** filter, pick `CrmContact`. Click search.
5. **What you'll see:**
   - **The customer was created and then `soft_delete`d** → see step 6.
   - **The customer was created** but no delete entry → see step 7.
   - **No entries for this customer at all** → see step 8.
6. **If soft_deleted:** Click the row to expand it — you'll see who deleted it and when. To restore: the customer record is still in the database with an `archivedAt` timestamp; an admin or developer can clear that field to bring it back. (We'll add a one-click "Restore" button to the Audit Log page in a future update.)
7. **If no delete entry:** the data exists but isn't visible in your browser. Try:
   - Hard-refresh: Cmd+Shift+R
   - Open in incognito
   - Open in a different browser
   - If it still doesn't show, contact your developer with the customer's name and the exact entry from the Audit Log.
8. **If no entries at all:** the data was never saved. Likely causes:
   - The customer was added on a different machine before the dual-write to the database was deployed, and only existed in *that browser's* localStorage. Re-create the record now — it will save permanently.
   - The save failed silently (highly unlikely after this fix-pass; the validator now blocks silent failures). Re-create with full information.

---

## Scenario 2 — All data appears to be gone after an update

**What it feels like:** "I logged in and the dashboard shows zero customers, zero quotes, zero anything."

### Steps

1. **Stop and breathe.** Don't add anything. Don't click anything.
2. **Confirm you're logged into the right account.** Look at the sidebar — does it say "EZBiz" and your profile name? If you're logged into a brand-new test account, no data is expected. Log out and back in with the right credentials.
3. **Check whether the database is even reachable.** In a browser, go to:
   ```
   https://www.systemssyndicate.com/api/health
   ```
   Look at the `database` block.
   - `database.status: "ok"` and counts > 0 → data exists, just not displaying. Hard-refresh, then if still wrong contact your developer.
   - `database.status: "error"` → the app can't reach the database. Continue to step 4.
   - `database.status: "ok"` but counts are zero → see step 5.
4. **Database unreachable:** check https://cloud.digitalocean.com/databases. The `fencepro-db` cluster should be green / healthy. If it's red or down, this is a DigitalOcean incident — they'll fix it. The data is safe; it's just temporarily inaccessible.
5. **Database is reachable but counts are zero:** this means the data really is missing from the database. *Do not let anyone else write to the app.* Contact your developer immediately and have them put the app in read-only mode by stopping pm2:
   ```
   ssh root@143.198.109.59
   pm2 stop fencepro
   ```
   Then follow `BACKUP_RESTORE_GUIDE.md` to restore from the most recent pre-deployment backup. The backup file is in `/var/backups/ezbiz/` named `pre-deploy_<TIMESTAMP>.sql.gz`.

---

## Scenario 3 — A file or photo a customer uploaded is missing

**What it feels like:** "I uploaded a photo to a customer and now it's gone."

### Steps

1. Open the customer's profile and go to the **Photos** or **Files** tab.
2. If it's not listed, open **Audit Log** and filter by `entityType: Document`. Look for `file_uploaded` or `file_deleted` entries near the time you uploaded.
3. **If file_uploaded exists but file_deleted does not:** the file is in storage but isn't being shown. Contact your developer.
4. **If file_deleted exists:** the file was removed by someone (you can see who and when in the audit log).
   - On the current setup, files are stored on the VPS at `/var/www/fencepro/portal/uploads/`. Once deleted, recovery requires a VPS-level snapshot (DigitalOcean droplet snapshots can be enabled but currently aren't).
   - The medium-term fix is to migrate file storage to S3 with versioning (deletion can be undone). This is documented in `DATA_STORAGE_ARCHITECTURE.md`.
5. **If no entries at all in the audit log for this file:** the upload likely failed silently. Re-upload now. If it fails again, screenshot the error and contact your developer.

---

## Scenario 4 — The whole site is down after a deployment

**What it feels like:** "The website won't load. I can't log in. Nothing works."

### Steps

1. Try https://www.systemssyndicate.com/api/health from a browser.
   - **Returns JSON:** the API is up; the frontend is broken. Skip to step 4.
   - **Times out / 502 / 504:** the API is down. Continue to step 2.
2. SSH to the VPS:
   ```
   ssh root@143.198.109.59
   ```
3. Check pm2 status:
   ```
   pm2 list
   pm2 logs fencepro --lines 50 --nostream
   ```
   Look for the most recent error message. Common ones:
   - `[env] ❌ CRITICAL` → an env variable is missing or bad. Check `/var/www/fencepro/portal/.env` against `apps/portal/.env.example`. Restart pm2.
   - `Error: connect ECONNREFUSED` → DB unreachable. See Scenario 2 step 4.
   - Migration error → the schema diff was destructive. Roll back: `git checkout <previous-sha>`, rebuild, restart. Then restore from the pre-deploy backup.
4. **If only the frontend is broken:** nginx might be serving a corrupted dist. Roll back the frontend:
   ```
   ssh root@143.198.109.59
   cd /var/www/fencepro/repo
   git checkout HEAD~1   # one commit back
   pnpm --filter web build
   rsync -av --delete apps/web/dist/ /var/www/fencepro/web/
   git checkout main
   ```
5. Once the site is up again, contact your developer with the exact error message and the pm2 log output.

---

## Scenario 5 — Wrong data was saved by mistake (one record)

**What it feels like:** "Someone changed a customer's phone number and it's wrong now" or "we deleted a quote we shouldn't have."

### Steps

1. **Don't manually fix it yet.** First confirm what was changed and to what.
2. Open **Admin → Audit Log**.
3. Filter by the customer's name in the **User** field, AND by entity type if you know it.
4. Find the row(s) matching the change. Click each one to expand — you'll see "Before" and "After" JSON columns showing exactly what was changed.
5. Decide:
   - **Manual fix:** if the original value is shown in "Before", you can just edit the record back to it manually.
   - **Backup restore:** if many fields changed or you can't tell which is right, restore *just the affected table* from a backup. This requires a developer — see `BACKUP_RESTORE_GUIDE.md`.
6. After the fix, log a note in your team channel about what happened so others know.

---

## Quick reference

| Symptom | Most likely cause | First action |
|---|---|---|
| One record missing | Soft-delete | Admin → Audit Log, search for it |
| All data missing on dashboard | Display issue OR DB unreachable | Check `/api/health` first |
| File missing | Deleted from `uploads/` | Audit Log filter `Document` |
| Site down | Bad deploy or env-var change | `pm2 logs fencepro` |
| Wrong field value | Bad edit | Audit Log → see Before/After |

When in doubt: contact your developer **before** trying to fix. Most data recovery is easier in the first hour than after multiple cleanup attempts have run.
