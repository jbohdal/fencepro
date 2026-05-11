# EZ Biz — External Services Setup Guide

This guide walks you through signing up for and configuring every external service used by EZ Biz. Complete each section and paste the credential into the corresponding environment variable.

---

## Environment Variables Overview

Create a `.env` file inside `apps/portal/` (never commit this file). Each variable is described below.

```env
# ── Required for boot ──────────────────────────────────────────────
DATABASE_URL=postgresql://user:pass@host:5432/dbname
JWT_SECRET=<random 64-char string>
JWT_REFRESH_SECRET=<different random 64-char string>
APP_URL=https://your-domain.com

# ── Required for web app ───────────────────────────────────────────
VITE_GOOGLE_MAPS_API_KEY=<see Google Maps section>

# ── Communication ──────────────────────────────────────────────────
SENDGRID_API_KEY=SG.xxxx
SMTP_FROM_EMAIL=noreply@yourdomain.com
SMTP_FROM_NAME=EZ Biz
TWILIO_ACCOUNT_SID=ACxxxx
TWILIO_AUTH_TOKEN=xxxx
TWILIO_FROM_NUMBER=+13215550100

# ── Payments ───────────────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_live_xxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxx

# ── Google ─────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxx
GOOGLE_REDIRECT_URI=https://your-domain.com/api/google-calendar/callback

# ── Storage ────────────────────────────────────────────────────────
UPLOAD_DIR=./uploads          # local storage (default)
# OR for S3:
AWS_ACCESS_KEY_ID=xxxx
AWS_SECRET_ACCESS_KEY=xxxx
AWS_S3_BUCKET=your-bucket
AWS_REGION=us-east-1

# ── Error Tracking ─────────────────────────────────────────────────
SENTRY_DSN=https://xxxx@sentry.io/xxxx

# ── Weather ────────────────────────────────────────────────────────
OPENWEATHERMAP_API_KEY=xxxx

# ── Field Operations ───────────────────────────────────────────────
COMPANYCAM_API_KEY=xxxx
CONNECTEAM_API_KEY=xxxx

# ── Accounting ─────────────────────────────────────────────────────
QUICKBOOKS_CLIENT_ID=xxxx
QUICKBOOKS_CLIENT_SECRET=xxxx
QUICKBOOKS_REDIRECT_URI=https://your-domain.com/api/quickbooks/callback

# ── Sync / Automation ──────────────────────────────────────────────
CRM_SYNC_KEY=<random secret shared between web app and portal server>
CLIENT_URL=https://your-domain.com

# ── Optional ───────────────────────────────────────────────────────
ADMIN_ALERT_EMAIL=admin@yourdomain.com
CORS_ORIGINS=https://your-domain.com,https://portal.your-domain.com
NODE_ENV=production
```

---

## 1. Database (PostgreSQL) — Required

**What it does:** Primary data store for portal accounts, automation rules, integrations, leads, and synced CRM data.

**Options:**
- **Supabase** (recommended for easy setup): https://supabase.com → New project → Settings → Database → Connection string (URI format)
- **Neon**: https://neon.tech
- **Railway**: https://railway.app
- **Self-hosted**: PostgreSQL 14+

**Steps:**
1. Create a PostgreSQL database (any provider above)
2. Copy the connection string (format: `postgresql://user:pass@host:5432/dbname`)
3. Set `DATABASE_URL=<connection string>`
4. Run migrations: `cd apps/portal && npx prisma migrate deploy`

---

## 2. Google Maps — Required for Address Autocomplete

**What it does:** Powers address autocomplete on all address fields, the Map Quote Builder, and the Dispatch map view.

**Steps:**
1. Go to https://console.cloud.google.com
2. Create a new project (or use an existing one)
3. Enable these APIs:
   - **Maps JavaScript API**
   - **Places API**
   - **Geocoding API**
   - **Directions API** (for route optimization)
4. Go to Credentials → Create Credentials → API Key
5. Restrict the key to the APIs above and your domain (recommended)
6. Copy the key and set `VITE_GOOGLE_MAPS_API_KEY=<key>` in `apps/web/.env`

**Cost:** Free tier includes $200/month credit. Autocomplete is ~$2.83 per 1,000 requests.

---

## 3. SendGrid — Required for Email Delivery

**What it does:** Sends all transactional emails: customer quote emails, portal invitations, payment receipts, automation-triggered emails, and admin alerts.

**Steps:**
1. Sign up at https://sendgrid.com (free tier: 100 emails/day)
2. Go to Settings → API Keys → Create API Key
3. Choose "Restricted Access" → Mail Send → Full Access
4. Copy the key (shown once) and set `SENDGRID_API_KEY=SG.xxxx`
5. Set `SMTP_FROM_EMAIL=noreply@yourdomain.com`
6. Set `SMTP_FROM_NAME=EZ Biz` (or your company name)
7. Verify your sender domain in SendGrid (Settings → Sender Authentication)

---

## 4. Twilio — Required for SMS

**What it does:** Sends SMS notifications triggered by automations, lead follow-ups, and appointment reminders.

**Steps:**
1. Sign up at https://twilio.com (free trial: $15 credit)
2. Go to Console Dashboard and note your **Account SID** and **Auth Token**
3. Buy a phone number: Phone Numbers → Manage → Buy a Number
4. Set:
   - `TWILIO_ACCOUNT_SID=ACxxxx`
   - `TWILIO_AUTH_TOKEN=xxxx`
   - `TWILIO_FROM_NUMBER=+1XXXXXXXXXX` (the number you purchased)

**Cost:** ~$1/month per number + ~$0.0079/SMS.

---

## 5. Stripe — Required for Payment Links

**What it does:** Creates payment links sent to customers for invoice payment. Receives payment webhooks to update invoice status.

**Steps:**
1. Sign up at https://stripe.com
2. Go to Developers → API Keys
3. Copy the **Secret key** (starts with `sk_live_`) and set `STRIPE_SECRET_KEY=sk_live_xxxx`
4. Set up webhook: Developers → Webhooks → Add endpoint
   - URL: `https://your-domain.com/api/integrations/webhooks/inbound/stripe`
   - Events: `payment_intent.succeeded`, `invoice.paid`
5. Copy the webhook **Signing secret** and set `STRIPE_WEBHOOK_SECRET=whsec_xxxx`

---

## 6. Google Calendar — Required for Appointment Sync

**What it does:** Two-way sync between the CRM schedule and Google Calendar. Appointments created in EZ Biz appear on the salesman's Google Calendar.

**Steps:**
1. Go to https://console.cloud.google.com (same project as Maps)
2. Enable the **Google Calendar API**
3. Go to Credentials → OAuth 2.0 Client IDs → Create (Web Application type)
4. Add authorized redirect URI: `https://your-domain.com/api/google-calendar/callback`
5. Set:
   - `GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com`
   - `GOOGLE_CLIENT_SECRET=xxxx`
   - `GOOGLE_REDIRECT_URI=https://your-domain.com/api/google-calendar/callback`

---

## 7. AWS S3 — Required for Document/Photo Storage in Production

**What it does:** Stores customer documents, job photos, and portal uploads. In development, local file storage is used automatically.

**Steps:**
1. Sign up at https://aws.amazon.com
2. Go to S3 → Create bucket (e.g., `ezbiz-uploads-prod`)
3. Go to IAM → Create User with programmatic access → attach `AmazonS3FullAccess` policy
4. Copy the **Access Key ID** and **Secret Access Key**
5. Set:
   - `AWS_ACCESS_KEY_ID=xxxx`
   - `AWS_SECRET_ACCESS_KEY=xxxx`
   - `AWS_S3_BUCKET=ezbiz-uploads-prod`
   - `AWS_REGION=us-east-1`

**Cost:** ~$0.023/GB/month for storage.

---

## 8. Sentry — Recommended for Error Tracking

**What it does:** Captures and reports runtime errors in production. Alerts you to crashes before customers complain.

**Steps:**
1. Sign up at https://sentry.io (free tier: 5,000 errors/month)
2. Create a new project (Node.js)
3. Copy the **DSN** from Project Settings → Client Keys
4. Set `SENTRY_DSN=https://xxxx@sentry.io/xxxx`

---

## 9. OpenWeatherMap — Required for Weather on Schedule Page

**What it does:** Shows a 7-day weather forecast on the Schedule page to help flag potential rain days before dispatching crews.

**Steps:**
1. Sign up at https://openweathermap.org/api (free tier: 1,000 calls/day)
2. Go to API Keys → Copy your default key
3. Set `OPENWEATHERMAP_API_KEY=xxxx`

---

## 10. CompanyCam — Field Photo Sync

**What it does:** Links CompanyCam job photo projects to EZ Biz customer records. Crews take photos on-site in CompanyCam; photos appear in the customer portal automatically.

**Steps:**
1. Sign up at https://companycam.com
2. Go to Account Settings → API → Generate API Key
3. Set `COMPANYCAM_API_KEY=xxxx`

**Note:** The CompanyCam adapter is currently stubbed (marked "Coming Soon" in the integrations UI). The API key will be used when the adapter is fully implemented.

---

## 11. Connecteam — Workforce Management

**What it does:** Syncs crew schedules, time tracking, and shift assignments between EZ Biz and Connecteam.

**Steps:**
1. Sign up at https://connecteam.com
2. Go to Settings → API → Generate API Key
3. Set `CONNECTEAM_API_KEY=xxxx`

**Note:** Marked "Coming Soon" — adapter is stubbed, pending implementation.

---

## 12. QuickBooks Online — Accounting Sync

**What it does:** Pushes invoices and payments to QuickBooks for bookkeeping. Pulls vendor expenses.

**Steps:**
1. Sign up at https://developer.intuit.com
2. Create an app in the Intuit Developer portal
3. Set redirect URI to `https://your-domain.com/api/quickbooks/callback`
4. Set:
   - `QUICKBOOKS_CLIENT_ID=xxxx`
   - `QUICKBOOKS_CLIENT_SECRET=xxxx`
   - `QUICKBOOKS_REDIRECT_URI=https://your-domain.com/api/quickbooks/callback`

**Note:** Marked "Coming Soon" — adapter is stubbed, pending implementation.

---

## 13. Zapier — Webhook Automation

**What it does:** Fires webhooks to Zapier (or any URL) when CRM events occur. Connect EZ Biz to thousands of apps via Zapier workflows.

**Steps:**
1. Log in at https://zapier.com
2. Create a new Zap → Trigger: Webhook (Catch Hook)
3. Copy the webhook URL (e.g., `https://hooks.zapier.com/hooks/catch/12345/abcdef/`)
4. In EZ Biz: Admin → Integrations → Zapier → paste the URL → Connect

No environment variable needed — the URL is stored in the Integrations settings per tenant.

---

## Quick Start (Development)

```bash
# 1. Clone the repo
git clone <repo-url>
cd ezbiz

# 2. Install dependencies
pnpm install

# 3. Set up environment
cp apps/portal/.env.example apps/portal/.env
# Edit apps/portal/.env with your DATABASE_URL and JWT_SECRET at minimum

# 4. Run database migrations
cd apps/portal
npx prisma migrate deploy
npx prisma db seed

# 5. Start both services
# Terminal 1:
cd apps/portal && pnpm dev:server

# Terminal 2:
cd apps/web && pnpm dev

# 6. Open http://localhost:5000
# Default CRM login: set via portal admin panel or seed file
```
