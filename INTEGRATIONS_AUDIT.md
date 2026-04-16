# FencePro CRM — Integrations Audit

Date: 2026-04-15

---

## 1. Existing External API Connections

### Active
| Service | File | Status | Auth Method |
|---------|------|--------|-------------|
| **Anthropic (Claude AI)** | lead-chat.ts, chat.ts | Configured (key in .env) | x-api-key header |
| **Google Calendar** | lib/googleCalendar.ts, routes/google-calendar.ts | Infrastructure built, not configured | OAuth 2.0 |

### Ready but Unconfigured
| Service | File | Status |
|---------|------|--------|
| **Twilio SMS** | lib/sms.ts | Fallback to console.log when no credentials |
| **SendGrid Email** | lib/emailService.ts | Fallback to console.log when no API key |
| **OpenWeatherMap** | SchedulePage.tsx | Frontend-only via VITE_OPENWEATHER_API_KEY |

### Not Yet Built
QuickBooks, Stripe, CompanyCam, Connecteam — no code exists for these.

---

## 2. Notification & Email System

### SMS (sms.ts)
- Provider: Twilio REST API (no SDK — raw fetch with Basic Auth)
- Functions: `sendSms()`, `sendLeadConfirmation()`, `sendAppointmentConfirmation()`, `sendFollowUp()`
- Called from: lead creation, appointment booking, follow-up scheduler
- Fallback: logs to console when TWILIO_* env vars are empty

### Email (emailService.ts)
- Provider: SendGrid API (primary), SMTP (secondary, stubbed)
- Functions: `sendEmail()`, `applyMergeTags()`, `buildEmailHtml()`
- Merge tags: `{{customer_name}}`, `{{job_address}}`, `{{scheduled_date}}`, `{{rep_name}}`, `{{job_stage}}`, `{{company_name}}`, `{{job_id}}`, `{{quote_price}}`
- Called from: automation engine (send_email action)
- Fallback: logs to console when SENDGRID_API_KEY is empty

### In-App Notifications (notificationService.ts)
- Storage: PostgreSQL via Prisma `Notification` model
- Functions: `createNotification()`, `getNotifications()`, `markRead()`, `getUnreadCount()`
- Types: info, warning, success, error, automation
- Recipients: specific user, role broadcast, or global

---

## 3. Webhook System

### Outbound (from automation engine)
- Action type: `fire_webhook` in automationEngine.ts
- Config: webhookUrl, webhookMethod (POST/GET/PUT), webhookHeaders
- Payload: `{ event, automation, timestamp }`
- No retry logic currently — single fire
- No HMAC signing on outbound payloads

### Inbound Trigger
- Endpoint: `POST /api/automations/trigger`
- Auth: X-API-Key header (CRM_SYNC_KEY) or Bearer JWT
- Fires all matching active automations for the given triggerType
- Called from CRM frontend via automationTrigger.ts

### No Dedicated Inbound Webhook Receiver
- No `/api/webhooks/inbound/{source}` endpoint exists
- No signature verification for external services
- No webhook event log table

---

## 4. Environment Variables

### apps/portal/.env
```
DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_EXPIRY, JWT_REFRESH_EXPIRY
CRM_PROVIDER, STORAGE_DRIVER, UPLOAD_DIR, PORT, CLIENT_URL, NODE_ENV
CRM_SYNC_KEY="dev-sync-key"
ANTHROPIC_API_KEY="sk-ant-api03-..." (live key)
AI_CHAT_MODEL, BOTPRESS_WEBHOOK_SECRET (empty)
COMPANY_NAME, TWILIO_ACCOUNT_SID (empty), TWILIO_AUTH_TOKEN (empty), TWILIO_FROM_NUMBER (empty)
```

### Secret Storage
- All secrets in plaintext .env file
- No encryption at rest
- No secrets manager
- Google Calendar OAuth tokens stored unencrypted in `GoogleCalendarToken` Prisma table

---

## 5. Public API Endpoints (No Auth)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/lead-chat/message` | AI chatbot message |
| `GET /api/lead-chat/session/:id` | Chat session history |
| `POST /api/leads` | Create lead (optional Botpress secret) |
| `POST /api/leads/conversation` | Store transcript |
| `POST /api/appointments` | Book appointment (optional Botpress secret) |
| `GET /api/ez-budget/widget/config` | Widget services/settings |
| `POST /api/ez-budget/widget/submit` | Submit widget quote |
| `GET /api/health` | Health check |
| `POST /api/automations/trigger` | Fire automations (API key auth) |

### No Public REST API
- No `/api/v1/` versioned endpoints
- No developer API keys system
- No API documentation page

---

## What Exists vs What Needs Building

| Component | Status |
|-----------|--------|
| Integration registry/table | Does not exist |
| Integration adapter pattern | Does not exist |
| API key management | Does not exist (only CRM_SYNC_KEY) |
| Integrations settings page | Does not exist |
| Inbound webhook receiver | Does not exist |
| Public REST API (v1) | Does not exist |
| Twilio adapter | Partially exists (sms.ts) — needs adapter wrapper |
| Google Calendar adapter | Partially exists (googleCalendar.ts) — needs adapter wrapper |
| OpenWeatherMap adapter | Frontend-only — needs server adapter |
| Outbound webhook retry | Does not exist |
