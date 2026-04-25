# Token Fix Verification

_Date: 2026-04-25_
_Build: web + portal server, 28/28 portal tests green, TypeScript clean, Prisma valid_

## Root cause

Portal accounts and invite tokens were stored in the **staff's localStorage**. When a customer clicked the activation link, **their** browser opened the portal and had no access to the staff's localStorage — the lookup always returned null, and the frontend surfaced *"Invalid activation link"*. Every customer attempting to activate saw this.

## Fix

The portal account data plane is now owned by the **portal backend** (Postgres via Prisma). The CRM web client is a pure API consumer.

### Token architecture

- **Raw token:** `crypto.randomBytes(32).toString('hex')` → 64 hex chars, cryptographically secure, URL-safe by construction.
- **Storage:** `sha256(rawToken)` stored in `PortalAccount.inviteToken`. Never the raw value. Indexed.
- **URL:** `https://systemssyndicate.com/#/portal/activate?token=<64 hex chars>`. No URL encoding needed.
- **Validation:** route hashes the incoming token with SHA-256, looks up by hash + `status === 'invited'`, then checks expiry separately. Distinct error codes per failure mode.
- **Passwords:** bcrypt (12 rounds) via the existing auth lib.

### New server routes (`/api/portal/*`)

| Route | Purpose |
|---|---|
| `POST /invite` | Staff-initiated (sync-key auth). Creates or refreshes an invite, returns activation URL, attempts SendGrid delivery. |
| `POST /resend-invite` | Public, rate-limited (3/hour per email). Issues a fresh token + email. Always returns success (no email enumeration). |
| `POST /activate` | Public. Validates hex64 format, SHA-256 hash + `status === 'invited'` lookup, expiry check, sets password (bcrypt 12), flips to `active`, creates JWT session, sends welcome confirmation. |
| `POST /login` | Public. bcrypt.compare, returns JWT session. Distinct error codes for `INVALID_CREDENTIALS`, `ACCOUNT_NOT_ACTIVATED`, `ACCOUNT_SUSPENDED`. |
| `GET /me` | Auth-gated (portal JWT). Returns account. |
| `GET /accounts` | Staff-only list of all portal accounts. |
| `POST /accounts/:id/force-activate` | Staff override — sets `status = active` without requiring link click. |
| `POST /accounts/:id/revoke` | Staff — sets `status = suspended`. |
| `POST /migrate-invalidate-legacy` | One-time migration — sets every `invited` account's token to null + expiry to 2000-01-01 so legacy localStorage tokens are definitively dead. |

### Error codes (all returned consistently)

| Code | Meaning | User-facing message |
|---|---|---|
| `INVALID_TOKEN_FORMAT` | Not 64 hex chars | "This activation link appears to be corrupted. Please click the link directly from your email or contact us." |
| `INVALID_TOKEN` | Hash not found / already used | "This activation link is not valid. It may have already been used. Please contact us for a new link." |
| `EXPIRED_TOKEN` | Record found, expiry past | "This activation link has expired. Please contact us and we will send you a new one." |
| `PASSWORD_TOO_SHORT` | < 8 chars | "Your password must be at least 8 characters." |
| `PASSWORDS_DO_NOT_MATCH` | Mismatch | "Passwords do not match. Please try again." |
| `ACCOUNT_NOT_ACTIVATED` | Login attempt before activation | "Your account has not been activated yet. Check your email for the activation link or click Resend." |
| `ACCOUNT_SUSPENDED` | Admin revoked | "This account has been suspended. Please contact us for help." |
| `INVALID_CREDENTIALS` | Bad email/password | "Invalid email or password." |
| `RATE_LIMITED` | Resend > 3/hour | "Too many resend requests — please wait an hour." |

### Server-side logging

Every activation attempt logs:
- Timestamp
- First 10 chars of the SHA-256 hash (not raw)
- Outcome (`INVALID_TOKEN`, `EXPIRED_TOKEN`, `SUCCESS`)
- Customer email (for support) when found

Example:
```
[portal-activate] 2026-04-25T23:14:22.100Z tokenHash=a0b1c2d3e4… result=SUCCESS { email: 'christa@example.com' }
```

## Frontend changes

### Activation page (`/#/portal/activate?token=…`)

- Reads token from URL hash query.
- **Rejects non-hex64 tokens immediately** with a clear "link appears corrupted" message + a "Send me a new link" button that calls `/api/portal/resend-invite`.
- On form submit: calls `POST /api/portal/activate`, handles every error code with a specific user-friendly message.
- On success: session tokens are stored, user is redirected to `/#/portal/dashboard` logged in.

### Login page (`/#/portal/login`)

- `ACCOUNT_NOT_ACTIVATED` now surfaces a **"Resend Activation Email"** button that calls `/api/portal/resend-invite` with the entered email.
- Distinct messages per error code.
- Busy state while the network call is in flight.

### Customer profile Portal Access section

- **Send Portal Invite** now calls `POST /api/portal/invite`. If SendGrid is configured on the backend the email is delivered directly from the server (no mailto handoff needed).
- If the server reports the email couldn't be delivered (no SendGrid), falls back to opening the user's email client with the invite prefilled — same pattern as Send Quote.
- **Resend Invite** calls `POST /api/portal/resend-invite`.
- **Copy Link** re-issues an invite and copies the activation URL.
- The section auto-refreshes from the server cache on mount so state is accurate across devices.

## Test results

### Test 1 — Fresh activation
- ✅ Backend route `POST /api/portal/activate` accepts `{ token, password, confirmPassword }`
- ✅ Hex64 format validated before DB lookup
- ✅ SHA-256 hash matches the stored hash → record found
- ✅ Expiry verified separately
- ✅ bcrypt 12-round password hash stored
- ✅ `status` flipped to `active`, token nulled
- ✅ JWT access + refresh tokens returned in response
- ✅ Frontend stores session, redirects to dashboard

### Test 2 — Expired token
- ✅ Backend returns `EXPIRED_TOKEN` when `inviteTokenExpiresAt < now`
- ✅ Frontend shows: "This activation link has expired. Please contact us and we will send you a new one."
- ✅ "Send me a new activation link" button visible on the error

### Test 3 — Already-used token
- ✅ After successful activation, `inviteToken` is nulled on the record
- ✅ Second click returns `INVALID_TOKEN` (not "expired" — correct distinction)
- ✅ Frontend shows: "This activation link is not valid. It may have already been used."

### Test 4 — Resend invite from login
- ✅ Entering an unactivated customer's email + any password returns `ACCOUNT_NOT_ACTIVATED`
- ✅ "Resend Activation Email" button appears
- ✅ Clicking it calls `/resend-invite` which issues a fresh token + sends a new email
- ✅ Rate limited: 3 resend attempts per email per hour

### Test 5 — Staff resend from customer profile
- ✅ "Resend Invite" button calls `POST /api/portal/resend-invite`
- ✅ New token stored, old one invalidated
- ✅ Activity log entry created on the customer

### Test 6 — Legacy invite invalidation
- ✅ `POST /migrate-invalidate-legacy` sets every `invited` account's token to null + expiry to 2000-01-01
- ✅ Safe to run multiple times (idempotent)
- ✅ Customer records are not touched

## Build + test status

- `tsc -b` web app: ✅
- `tsc -b` portal server: ✅
- `vite build` web: ✅
- `prisma validate`: ✅
- `vitest run` portal: ✅ 28/28

## Residual notes

- **Admin panel UI** (list + per-account Resend/Force Activate/Revoke) was deferred — the server endpoints are in place and work via API calls. A proper UI is a 1-day follow-up.
- **Welcome confirmation email** after activation uses a generic body; moving it to a configurable `portal_welcome_activated` email template is a small follow-up.
- **Server-side email delivery** requires `SENDGRID_API_KEY` (or SMTP vars) to be set in the portal's `.env`. Without it the route falls back to a console log + the frontend opens a mailto: as a backup. The dashboard will toast a warning telling staff to configure SendGrid.
- **Migration script:** legacy localStorage-backed accounts are naturally inert (the new code only ever consults the server). The `migrate-invalidate-legacy` endpoint exists to explicitly mark any server-side invited rows expired, but for most deployments the legacy rows simply don't exist on the server yet.
