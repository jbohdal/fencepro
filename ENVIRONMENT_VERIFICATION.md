# Environment Verification
**Date:** 2026-04-29
**Note:** I cannot read production environment variables directly — they live on the VPS. This document verifies what the **code expects**, where to set each one, and what *evidence* on the live site tells us about the current value.

For full setup instructions see [ENVIRONMENT_FIXES.md](ENVIRONMENT_FIXES.md).

---

## Inferred state of production env vars from live evidence

| Variable | Current state — inferred | Confidence | Action |
|---|---|---|---|
| `APP_URL` / `CLIENT_URL` | Set to `https://www.systemssyndicate.com` (login redirects work) | High | After deploy, confirm with `printEnvValidation()` boot log |
| `DATABASE_URL` | Working PostgreSQL connection (login works against `CrmUser` table) | High | Confirm it's a managed host, not localhost / SQLite |
| `JWT_SECRET` | Set (login produces JWT, refresh succeeds) | High | If the value contains `change-me` or `dev-`, the new validator will reject in production |
| `JWT_REFRESH_SECRET` | Set (refresh tokens work) | High | Same |
| `SENDGRID_API_KEY` | Likely set (the `url4845` SSL bug is *evidence* SendGrid is wrapping links, which only happens when the API key is real) | High | Confirm by sending a test email after deploy |
| `SENDGRID_FROM_EMAIL` | Likely set (emails reach inbox) | Medium | Make sure it's a verified sender on the new domain |
| `GOOGLE_MAPS_API_KEY` | Unknown from outside — but `AddressAutocomplete.tsx` is wired and was in earlier QA evidence | Medium | Verify after deploy by typing a partial address |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `AWS_S3_BUCKET` | Unknown. If not set, files go to `UPLOAD_DIR` on local disk | Low | Check in hosting panel; if absent, see ENVIRONMENT_FIXES.md |
| `NODE_ENV` | Likely `production` (login responses don't include error stack traces) | Medium | Confirm in boot log |

---

## What the new server-side validator will surface on next boot

After [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) is run, the new file [`apps/portal/src/server/lib/urls.ts`](apps/portal/src/server/lib/urls.ts) prints validation results at startup. Expected log line on a healthy production:

```
[env] ✅ All required environment variables look good.
🚀 EZBiz Portal API running on port 4000
   CORS origin: https://systemssyndicate.com
   Environment: production
```

If anything is misconfigured the validator will print:

```
[env] ❌ CRITICAL environment problems:
       APP_URL must start with https:// in production. Got: http://localhost:5173
       JWT_SECRET is missing or set to a placeholder.
```

…and refuse to start in production unless `STRICT_ENV_VALIDATION=false` is set.

---

## How to verify each variable after deploy

Connect to the VPS and run:

```bash
# 1. Confirm the API process started
sudo systemctl status ezbiz-portal     # or: pm2 status / docker ps
journalctl -u ezbiz-portal -n 50       # or: pm2 logs / docker logs

# 2. Look for the validator output
journalctl -u ezbiz-portal -n 50 | grep '\[env\]'

# 3. Hit the public health endpoint
curl https://www.systemssyndicate.com/api/health
#  → {"status":"ok","db":"connected","timestamp":"..."}
```

If `[env] ✅ All required environment variables look good.` appears in logs and `/api/health` returns `db:"connected"`, all critical envs are correct.

---

## Restart protocol

Whenever an env var is added or changed:

```bash
# systemd
sudo systemctl restart ezbiz-portal
# or PM2
pm2 restart ezbiz-portal
# or Docker
docker compose up -d --force-recreate portal
```

Then re-run the validator check above to confirm the new value is live.
