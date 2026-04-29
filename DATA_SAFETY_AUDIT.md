# Data Safety Audit — current state
**Date:** 2026-04-29
**App:** EZBiz CRM at https://www.systemssyndicate.com
**Owner:** Jonathan Bohdal · Getter Done Fence

This is the honest, evidence-based assessment of data protection *as it stands today*. Where there's a known weakness, it's flagged so the rest of this fix-pass can address it.

---

## 1. Database service

| Item | Value |
|---|---|
| Provider | **DigitalOcean Managed Databases** |
| Engine | PostgreSQL |
| Hostname | `fencepro-db-do-user-35989004-0.j.db.ondigitalocean.com:25060` |
| Database name | `defaultdb` |
| TLS | enforced (`sslmode=require` in DATABASE_URL) |
| Plan tier | Unknown from outside; user must confirm in https://cloud.digitalocean.com/databases — likely Basic ($15/mo) given the project's age and scale |

**Automatic backups:** DigitalOcean Managed PostgreSQL takes **daily automated backups** by default at every plan tier. They cannot be disabled. Retention varies:

| Plan | Retention |
|---|---|
| Basic ($15) | 7 days |
| Professional ($60+) | 7 days (longer with PITR add-on) |

✅ **First-line defense is in place by default.** The user should still confirm and (if available) extend retention.

## 2. Database vs application server location

| | |
|---|---|
| Application server | Droplet `143.198.109.59` (Ubuntu 24.04, nginx + pm2 + Node 22, runs at `/var/www/fencepro/`) |
| Database server | **Separate** managed service in DigitalOcean's database fleet (`*.j.db.ondigitalocean.com`) |
| Same machine? | **No** — restarting the droplet does not touch the database |

✅ Good. A code deploy or app-server restart cannot kill the database.

## 3. Current backup frequency

| Layer | Frequency | Status |
|---|---|---|
| DigitalOcean automated DB backups | daily | ✅ active by default |
| Pre-deployment app-side backup | — | ❌ **not implemented** |
| Hourly / on-write backups | — | ❌ not implemented |
| File / photo backups (the `uploads/` dir) | — | ❌ **not implemented** — currently no copy of these exists outside the droplet |

## 4. Current backup retention

| Layer | Retention |
|---|---|
| DigitalOcean DB backups | 7 days (default) |
| Self-managed backups | n/a (not set up) |

## 5. Has any backup ever been tested by restoring from it?

❌ **No.** Backups have never been restored end-to-end. Until tested, "backups exist" and "data is recoverable" are two different things.

This is the single most common cause of unrecoverable data loss in real-world incidents — the team thinks they have backups, but they were never actually restored to verify.

## 6. Where uploaded files / photos are stored

| | |
|---|---|
| `STORAGE_DRIVER` env var | `local` (or unset, which defaults to local) |
| Local path | `/var/www/fencepro/portal/uploads` (set by `UPLOAD_DIR`) |
| What lives there | Customer-uploaded photos, customer-uploaded documents, staff-uploaded files |
| S3 bucket | **Not configured.** No `AWS_S3_BUCKET`, no AWS credentials in the prod env. |

⚠️ **High risk.** The `uploads/` directory is on the droplet's disk. If the droplet is destroyed (manual delete, snapshot rollback, hosting incident) every file ever uploaded is gone. There is no copy.

## 7. S3 versioning

❌ Not applicable — no S3 bucket exists yet.

## 8. S3 deletion protection / lifecycle rules

❌ Not applicable — no S3 bucket exists yet.

## 9. What happens to data during a deployment

Today's deploy procedure (just exercised):

1. SSH to droplet
2. `git clone` or `git pull` into `/var/www/fencepro/repo/`
3. `pnpm install --frozen-lockfile`
4. `npx prisma db push` (the schema sync — this *can* be destructive)
5. `pnpm --filter web build` + portal `build:server`
6. `rsync` into `/var/www/fencepro/web/` and `/var/www/fencepro/portal/dist/`
7. `pm2 restart fencepro` (kills the running Node process, starts a new one)

Risks introduced by this procedure:

| # | Risk | Today's exposure |
|---|---|---|
| 1 | **`prisma db push` is destructive on schema mismatches.** If the schema in code drops or renames a column, `db push` will warn but can be told to proceed. We've used `--accept-data-loss` historically (we didn't this time, but the flag exists). | Medium |
| 2 | **`pm2 restart` kills in-flight requests.** Anyone mid-save when the deploy lands gets a connection error and may lose unsaved input. | Medium |
| 3 | **No pre-deployment snapshot.** If a migration corrupts data, the only fallback is DigitalOcean's automated backup which is up to 24 hours stale. | High |
| 4 | **No automated rollback.** If the new build crashes on boot, pm2 keeps restarting it; nginx keeps serving the *old* frontend dist (which is fine), but the API is offline until manually fixed. | Medium |

This phase's deliverables address all four.

## 10. Has any environment variable change ever caused a database connection to fail silently?

Not that we know of, but the system was vulnerable to it until this fix-pass: pre-existing code didn't validate `DATABASE_URL` at startup. The `validateProductionEnv()` helper added in `apps/portal/src/server/lib/urls.ts` (deployed today) closes that gap by failing the boot in production if `DATABASE_URL` is missing, points to `file:`, or points to localhost.

✅ This is now protected at startup. We extend it in Phase 6 with email alerting.

## 11. Migration strategy

| Strategy | Status |
|---|---|
| Manual review of pending migrations | Yes — Prisma reports migrations before applying |
| `prisma migrate deploy` (formal migration history) | ❌ Not used. Production was set up via `prisma db push` and has no `_prisma_migrations` table. |
| `prisma db push` (schema sync) | ✅ Currently used. We just ran `db push` to add `CrmContact`. |
| Rollback (down migrations) | ❌ Not available. `db push` doesn't generate down scripts. |
| Pre-migration backup | ❌ Not enforced. |

**Implication:** until we move to formal migrations, every schema change relies on:
- the schema diff being purely additive
- the operator (us) reviewing the `db push` plan before confirming
- a pre-deployment DB snapshot existing as a recovery path

Phase 4 of this fix-pass addresses all three.

---

## Summary table — risk posture before this fix-pass

| Layer | Status |
|---|---|
| DB persistence (right server, right type) | ✅ DigitalOcean Managed PG |
| Daily DB backup (provider) | ✅ default 7-day retention |
| Pre-deploy DB snapshot | ❌ |
| File / photo backup | ❌ uploads only on droplet disk |
| S3 versioning / MFA-delete | ❌ no S3 yet |
| Backup restore tested | ❌ never tried |
| Audit log (who changed what) | ❌ not implemented |
| Daily count-snapshot anomaly alert | ❌ not implemented |
| Graceful shutdown (zero-downtime deploy) | ❌ pm2 hard-kills |
| Migration safety (block destructive prod migrations) | ❌ no enforced check |
| Disaster runbook for non-developer | ❌ not written |

Everything below 100% is fixed in the rest of this fix-pass.
