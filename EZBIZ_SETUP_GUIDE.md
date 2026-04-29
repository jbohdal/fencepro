# EZBiz — Setup & Deployment Guide

_Updated: 2026-04-26_

This guide covers a fresh deploy of EZBiz to a server (currently DigitalOcean Droplet). For local dev, skip to the bottom.

## Architecture

```
┌─ apps/web/         CRM (React + Vite, single-page app)
├─ apps/portal/      Customer Portal + Express API server
│  ├─ src/server/    Express app with Prisma → Postgres
│  └─ src/client/    Customer-facing portal (separate Vite app)
└─ packages/         Shared types
```

Production layout on the droplet:
```
/var/www/fencepro/         (path retained for backward compatibility)
├─ portal/                 PM2 runtime: dist/ + prisma/ + node_modules/ + uploads/
├─ web/                    Static: dist/ served by nginx
└─ repo/                   Source for builds
```

Single PM2 process: `fencepro` (process name retained for backward compatibility).

## Required environment variables

Copy `apps/portal/.env.example` (if it exists) or set these on the production server:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string. Use `?sslmode=require` for hosted DBs. |
| `JWT_SECRET` | ✅ | 32+ byte random hex. Used for access tokens. |
| `JWT_REFRESH_SECRET` | ✅ | Distinct from `JWT_SECRET`. |
| `JWT_ACCESS_EXPIRY` | ✅ | Default `15m`. |
| `JWT_REFRESH_EXPIRY` | ✅ | Default `7d`. |
| `PORT` | ✅ | Default 4000. |
| `CLIENT_URL` | ✅ | The CRM URL. Used for CORS origin and email links. |
| `APP_URL` | optional | Public URL (used in email links). Defaults to `CLIENT_URL`. |
| `NODE_ENV` | ✅ | `production` in prod, `development` for local. |
| `CRM_SYNC_KEY` | ✅ | 32-byte random hex. Header `X-API-Key` for staff-side calls into the portal data plane. |
| `CRM_PROVIDER` | ✅ | Set to `fencepro`. Selects the in-process CRM adapter. |
| `COMPANY_NAME` | recommended | Override the default `"EZBiz"` brand string in emails / docs. |
| `SMTP_FROM` | optional | Defaults to `COMPANY_NAME` or `"EZBiz"`. |
| `SMTP_FROM_EMAIL` | recommended | Defaults to `noreply@ezbiz.app`. **Must be a verified sender.** |
| `SENDGRID_API_KEY` | recommended | If unset, falls back to SMTP host vars. |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` | optional | SMTP fallback if SendGrid absent. |
| `TWILIO_ACCOUNT_SID` `TWILIO_AUTH_TOKEN` `TWILIO_FROM_NUMBER` | optional | Required for SMS automations. |
| `STRIPE_SECRET_KEY` `STRIPE_WEBHOOK_SECRET` | optional | Required for invoice payments. |
| `OPENWEATHER_API_KEY` | optional | Weather widget on schedule. |
| `GOOGLE_MAPS_API_KEY` | optional | Address autocomplete + geocoding. |
| `CORS_ORIGINS` | optional | Comma-separated extra allowed origins. |
| `UPLOAD_DIR` | optional | Default `./uploads`. Must be writable + persisted across PM2 restarts. |

The server will throw a startup error if `DATABASE_URL`, `JWT_SECRET`, or `JWT_REFRESH_SECRET` are missing.

## First-time droplet setup

```bash
# As root on the droplet
apt update && apt install -y nodejs npm postgresql nginx
npm install -g pnpm pm2
mkdir -p /var/www/fencepro/{repo,portal,web,portal/uploads}
```

Configure nginx to:
- Serve `/var/www/fencepro/web/dist/` as the CRM at `/`.
- Serve `/var/www/fencepro/portal/dist/client/` (or similar) as the portal at `/portal/`.
- Reverse-proxy `/api/*` to `http://localhost:4000`.
- Force HTTPS via Let's Encrypt (`certbot`).

## Deploying a new version

```bash
# Local
rsync -az --exclude node_modules --exclude dist apps/portal/ root@<droplet>:/var/www/fencepro/repo/apps/portal/
rsync -az --exclude node_modules --exclude dist apps/web/    root@<droplet>:/var/www/fencepro/repo/apps/web/

# On the droplet
ssh root@<droplet>
cd /var/www/fencepro/repo/apps/portal
npx prisma db push --accept-data-loss   # syncs schema
npx prisma generate                     # regenerates client
npx tsc -p tsconfig.server.json         # builds server → dist/
rsync -a --delete dist/ /var/www/fencepro/portal/dist/
cp prisma/schema.prisma /var/www/fencepro/portal/prisma/schema.prisma
cd /var/www/fencepro/portal && npx prisma generate    # regen client at runtime location

cd /var/www/fencepro/repo/apps/web
npx vite build
rsync -a --delete dist/ /var/www/fencepro/web/dist/

pm2 restart fencepro
curl -s https://systemssyndicate.com/api/health  # smoke test
```

## First-login checklist for a new company

After deploy:
1. Visit `https://<your-domain>` → redirected to login.
2. Log in with the seeded super-admin (set up via Prisma seed or manual SQL insert into `CrmUser`).
3. **Settings → Company Info** — set company name, logo, address, phone.
4. **Settings → Business Type** — select your trade. (UI exists; default seed is fence-specific.)
5. **Settings → Pricing** — set man-hour rate, commission rates, overhead, sales-tax rate.
6. **Settings → Pipeline Stages** — review and customize the stages.
7. **Settings → Operations Stages** — review.
8. **Settings → Email Templates** — review the portal-invite, quote-sent, invoice-sent templates.
9. **Settings → Integrations** — enter API keys for the integrations you'll use (Stripe, Twilio, Google Maps, OpenWeather, SendGrid).
10. **User Management** — invite team members.
11. **Customers** — start adding real customers or import via CSV.

## Verifying the deploy

```bash
# Health check
curl -s https://<your-domain>/api/health
# Expect: {"status":"ok","db":"connected","timestamp":"..."}

# Inbox endpoint
curl -s -H "X-API-Key: $CRM_SYNC_KEY" https://<your-domain>/api/portal/messages/inbox
# Expect: {"success":true,"data":{"threads":[],"totalUnread":0}}
```

## Local development

```bash
# From repo root
pnpm install
cd apps/portal && cp .env.example .env  # fill in DATABASE_URL etc.
pnpm db:push                            # syncs schema
pnpm db:seed                            # optional sample data
pnpm dev                                # concurrently runs server + portal client
# In another terminal:
cd apps/web && pnpm dev                 # CRM at http://localhost:5173
```

Default ports:
- 5173 — CRM (Vite)
- 5174 — Portal client (Vite)
- 4000 — Portal API (Express)

## Backups

Postgres backups: rely on the managed-DB provider's daily snapshots. Test a restore quarterly.

File uploads: `/var/www/fencepro/portal/uploads/` should be on a persistent volume. Production currently uses local-disk; migrating to S3 is a future improvement (planned).

## Troubleshooting

- **502 Bad Gateway** — PM2 process crashed. `pm2 logs fencepro --err --lines 50`.
- **All emails 403** — SendGrid sender unverified. Verify in SendGrid console + ensure `SMTP_FROM_EMAIL` matches a verified sender.
- **Portal customers can't activate** — check `PortalAccount.inviteTokenExpiresAt`. Tokens expire in 7 days.
- **Customer photo uploads fail** — check `UPLOAD_DIR` is writable; check PM2 process has disk quota.
- **Customer can log in but the CRM shows nothing** — multi-tenant gap (see Known Issues #1) — each browser is its own tenant in the current architecture.
