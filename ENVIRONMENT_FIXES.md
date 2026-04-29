# Environment Variable Fixes
**Date:** 2026-04-28
**Where to set:** Your hosting platform's "Environment Variables" panel (Vercel → Settings → Environment Variables · Render → Environment · Railway → Variables · Fly → `flyctl secrets set`).

The new startup validator (`apps/portal/src/server/lib/urls.ts`) prints clear errors for any of the **critical** entries below at boot. In production it will exit with code 1 if any critical variable is missing or set to a placeholder. Set `STRICT_ENV_VALIDATION=false` to bypass (not recommended).

---

## Critical (server refuses to start in production without these)

### `APP_URL`
**Value:** `https://systemssyndicate.com`
**Why:** the canonical frontend URL used by every invite, activation, password-reset, and notification email link. The validator rejects values that don't start with `https://` in production, and explicitly rejects values containing the SendGrid `urlNNNN.` prefix (a sign that someone copied a click-tracked URL into the env panel by mistake).

### `DATABASE_URL`
**Value:** A managed-Postgres connection string. **Must NOT** start with `file:` and **must NOT** point to localhost in production.
**Why:** SQLite (`file:`) and `localhost` Postgres on app-server disk are ephemeral on Render/Railway/Fly/Vercel and lose every customer's data on each deploy.

Recommended: Neon (`postgresql://USER:PASS@HOST.neon.tech/DB?sslmode=require`).

### `JWT_SECRET`
**Value:** A random ≥64-character string. Generate with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
**Why:** signs CRM access tokens. The default `dev-crm-jwt-secret-change-me` is rejected.

### `JWT_REFRESH_SECRET`
**Value:** A different random ≥64-character string (regenerate from the same command).
**Why:** signs CRM refresh tokens; must differ from `JWT_SECRET`.

---

## Highly recommended (warnings)

### `SENDGRID_API_KEY`
**Value:** Real SendGrid API key.
**Why:** without it, all invite/activation/password-reset/notification emails are silently logged to console and never delivered. The validator warns when no email backend is configured.

### `SENDGRID_FROM_EMAIL` *(or `SMTP_FROM_EMAIL`)*
**Value:** A verified sender email at your domain (e.g. `noreply@systemssyndicate.com`).
**Why:** SendGrid rejects sends from unverified senders.

### `STORAGE_DRIVER` + AWS credentials
- `STORAGE_DRIVER=s3`
- `AWS_S3_BUCKET=ezbiz-prod-uploads`
- `AWS_REGION=us-east-1` (or your bucket's region)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

**Why:** the default `local` driver writes to `${UPLOAD_DIR}` on the app server's disk, which is ephemeral on most hosting platforms. Customer-uploaded photos and documents will be lost on each deploy.

### `NODE_ENV`
**Value:** `production`
**Why:** activates the strict env validator and other production hardening.

---

## Optional / situational

| Variable | Purpose |
|---|---|
| `CLIENT_URL` | Legacy alias for `APP_URL`. Set both to the same value. |
| `CORS_ORIGINS` | Comma-separated list of additional allowed CORS origins. |
| `COMPANY_NAME` | Branding in email subject lines. Defaults to "EZBiz". |
| `COMPANY_PHONE` | Used in invite/notification email footers. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | Outbound SMS. Logs to console if absent. |
| `ANTHROPIC_API_KEY` | AI chatbot. Falls back to rule-based replies if absent. |
| `BOTPRESS_WEBHOOK_SECRET` | Botpress lead-chat integration. |
| `STRIPE_SECRET_KEY` | Payments via Stripe. |
| `CRM_SYNC_KEY` | Shared key between CRM frontend and the sync API; default `dev-sync-key`. |
| `STRICT_ENV_VALIDATION` | Set to `false` to bypass production env validator (not recommended). |

---

## Setting these on each platform

### Vercel
```
Settings → Environment Variables → Add
Scope: Production
```
After saving, redeploy.

### Render
```
Service → Environment → Add Environment Variable
```
Auto-deploys on save.

### Railway
```
Variables → New Variable
```
Auto-redeploys.

### Fly.io
```bash
flyctl secrets set APP_URL=https://systemssyndicate.com
flyctl secrets set JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
# etc.
```

---

## Sanity check after setting

After redeploy, the boot logs should show:

```
[env] ✅ All required environment variables look good.
🚀 EZBiz Portal API running on port 4000
   CORS origin: https://systemssyndicate.com
   Environment: production
```

If you see any `[env] ❌ CRITICAL` lines, fix them and redeploy before users hit the site.
