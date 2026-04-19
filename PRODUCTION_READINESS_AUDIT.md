# Production Readiness Audit — FencePro CRM

Date: 2026-04-16
Domain: systemssyndicate.com

---

## Section 1 — Environment Variables

### Portal Backend (apps/portal/.env)
| Variable | Purpose | Has Value | Status |
|----------|---------|-----------|--------|
| DATABASE_URL | PostgreSQL connection | Yes (local) | Server uses DO managed DB — OK on server |
| JWT_SECRET | Access token signing | Yes (dev placeholder) | WEAK — needs strong random value |
| JWT_REFRESH_SECRET | Refresh token signing | Yes (dev placeholder) | WEAK |
| JWT_ACCESS_EXPIRY | Token TTL | Yes (15m) | OK |
| JWT_REFRESH_EXPIRY | Refresh TTL | Yes (7d) | OK |
| CRM_PROVIDER | Adapter selection | Yes | OK |
| STORAGE_DRIVER | File storage type | Yes (local) | OK for now |
| UPLOAD_DIR | File upload path | Yes (./uploads) | OK |
| PORT | Server port | Yes (4000) | OK |
| CLIENT_URL | CORS origin | Yes (localhost) | Server has correct value |
| NODE_ENV | Environment flag | Yes | Server set to development (should be production) |
| CRM_SYNC_KEY | API sync auth | Yes (dev-sync-key) | CRITICAL — hardcoded in frontend |
| ANTHROPIC_API_KEY | AI chat | Yes (live key) | Key exposed in repo |
| AI_CHAT_MODEL | Model selection | Yes | OK |
| BOTPRESS_WEBHOOK_SECRET | Webhook auth | Empty | NOT SET |
| COMPANY_NAME | Branding | Yes | OK |
| TWILIO_ACCOUNT_SID | SMS sending | Empty | NOT SET |
| TWILIO_AUTH_TOKEN | SMS auth | Empty | NOT SET |
| TWILIO_FROM_NUMBER | SMS sender | Empty | NOT SET |
| SENDGRID_API_KEY | Email sending | Empty | NOT SET — emails log to console |
| SMTP_FROM_EMAIL | Email sender | Yes | OK |
| GOOGLE_CLIENT_ID | Calendar OAuth | Empty | NOT SET |
| GOOGLE_CLIENT_SECRET | Calendar OAuth | Empty | NOT SET |
| GOOGLE_REDIRECT_URI | OAuth callback | Yes (localhost) | WRONG for production |

### CRM Frontend (apps/web/.env)
| Variable | Purpose | Has Value | Status |
|----------|---------|-----------|--------|
| VITE_GOOGLE_MAPS_API_KEY | Maps + geocoding | Yes (live) | OK — frontend keys are public |
| VITE_OPENWEATHER_API_KEY | Weather widget | Empty | NOT SET |

---

## Section 2 — External Services

| Service | Status | Credentials | Notes |
|---------|--------|------------|-------|
| Anthropic Claude | ACTIVE | Key in .env | AI chatbot works but key was exposed |
| Google Maps | ACTIVE | Key in web .env | Working — needs domain restriction |
| SendGrid | NOT CONFIGURED | Empty | All emails log to console |
| Twilio | NOT CONFIGURED | Empty | All SMS log to console |
| OpenWeatherMap | NOT CONFIGURED | Empty | Weather widget shows nothing |
| Google Calendar | ADAPTER EXISTS | Empty | OAuth flow built but not configured |
| Stripe | STUB ONLY | N/A | Listed as "Coming Soon" |
| QuickBooks | STUB ONLY | N/A | Listed as "Coming Soon" |
| CompanyCam | STUB ONLY | N/A | Listed as "Coming Soon" |
| Connecteam | STUB ONLY | N/A | Listed as "Coming Soon" |

---

## Section 3 — Broken or Incomplete

1. **SMTP fallback** — sendViaSmtp() returns `success: true` but never actually sends
2. **File virus scan** — scanFile() always returns `{ clean: true }` (stub)
3. **Webhook signature verification** — inbound webhooks log signatures but never verify
4. **Cron secret** — follow-up cron endpoint open if CRON_SECRET not set
5. **Sync key in frontend** — 5 files hardcode `dev-sync-key` in client-side code
6. **Coming Soon integrations** — QuickBooks, Stripe, CompanyCam, Connecteam are UI stubs

---

## Section 4 — Production Config Gaps

1. NODE_ENV set to `development` on server — CORS allows all origins
2. No startup validation for critical env vars
3. JWT secrets have weak fallback values
4. Error handler shows stack traces (express default)
5. Health check exists at /api/health — OK
6. Rate limiting on login/upload/general API — OK
7. Trust proxy set — OK (fixed previously)
8. Hardcoded localhost references — fixed in frontend, still in some server fallbacks

---

## Section 5 — Email System

| Trigger | Template | Service | Works? |
|---------|----------|---------|--------|
| Team invite | HTML in crm-auth.ts | SendGrid | NO — no API key |
| Password reset | HTML in crm-auth.ts | SendGrid | NO — no API key |
| Lead confirmation SMS | Text in sms.ts | Twilio | NO — no credentials |
| Appointment confirmation SMS | Text in sms.ts | Twilio | NO — no credentials |
| Follow-up sequence SMS | Text in followUpScheduler | Twilio | NO — no credentials |
| Automation emails | HTML via emailService | SendGrid | NO — no API key |

---

## Section 6 — Webhooks & Automations

| Endpoint | Verification | Status |
|----------|-------------|--------|
| POST /api/webhooks/inbound/:source | Logs signature, no verification | INSECURE |
| POST /api/automations/trigger | X-API-Key (dev-sync-key) | WEAK |
| POST /api/leads | Optional Botpress secret (empty) | OPEN |
| POST /api/appointments | Optional Botpress secret (empty) | OPEN |
| POST /api/ez-budget/widget/submit | None | OPEN (by design) |
| POST /api/cron/follow-ups | Optional CRON_SECRET | OPEN if not set |
