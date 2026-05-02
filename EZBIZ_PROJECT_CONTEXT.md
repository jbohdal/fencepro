# EZBiz — Project Context (Onboarding)

_Generated: 2026-05-01. Purpose: a single document that catches up a new Claude Code session (or a new human contributor) on what this repo is, how it's laid out, where the tricky bits live, and how to start a session without breaking anything._

> **Brand note.** "EZBiz" is the SaaS platform brand. "FencePro" is the legacy name still embedded in package names, PM2 process name, the deploy path (`/var/www/fencepro/`), and `localStorage.fencepro_*` keys. These are intentionally NOT renamed — see [EZBIZ_AUDIT_SUMMARY.md](EZBIZ_AUDIT_SUMMARY.md) "Rename inventory" for why. The user-facing surface says EZBiz; internal identifiers still say fencepro.

---

## 1. What this product is

EZBiz is a vertical-SaaS CRM for service businesses. The current customer (Jonathan, Getter Done Fence, FL) runs a fence company; the platform is being generalized so other trades (HVAC, roofing, pool, paint…) can also use it. The fence-flavored bits — the **estimating engine** in particular — are intentionally trade-specific; everything else (pipeline, ops, billing, AR/AP, P&L, portal) is trade-neutral or configurable.

Two surfaces ship together from one repo:

- **CRM web app** (`apps/web`) — the staff-facing single-page React app. Sales pipeline, quote builder, ops board, schedule, billing, P&L, vendors, integrations.
- **Customer portal + API server** (`apps/portal`) — Express + Prisma backend that serves both `/api/*` and a separate Vite-built customer-facing portal (`apps/portal/src/client`). The portal is what end-customers log into to see invoices, contracts, photos, documents, message staff, and chat.

---

## 2. Repository layout

```
fencepro/                              ← repo root (path retained for backward compat)
├─ apps/
│  ├─ web/                             CRM SPA (React 19 + Vite)
│  │   ├─ src/                         54 page components + 28 *Store.ts files
│  │   ├─ index.html
│  │   ├─ vite.config.ts, tsconfig.app.json
│  │   └─ package.json                 name: "web"
│  ├─ portal/                          Customer Portal + Express API (one PM2 process)
│  │   ├─ src/
│  │   │   ├─ server/                  Express 5 app
│  │   │   │   ├─ index.ts             route wiring, helmet, CORS, rate limits
│  │   │   │   ├─ routes/              25 route files (see §5)
│  │   │   │   ├─ middleware/          auth, crmAuth, audit
│  │   │   │   ├─ lib/                 prisma, auth, emailService, sms,
│  │   │   │   │                       quoteEngine, automationEngine,
│  │   │   │   │                       googleCalendar, leadScoring, …
│  │   │   │   ├─ integrations/        adapters/ + registry.ts + types.ts
│  │   │   │   └─ lib/storage/         file-upload abstraction
│  │   │   ├─ client/                  Customer-facing portal SPA (Vite)
│  │   │   └─ types/
│  │   ├─ prisma/
│  │   │   ├─ schema.prisma            ★ THE active schema (1452 lines)
│  │   │   └─ seed.ts
│  │   ├─ scripts/                     backup-database.ts, restore-database.ts,
│  │   │                               pre-deploy-backup.ts, migration-safety-check.ts,
│  │   │                               seed-ez-budget.ts
│  │   ├─ tests/                       vitest: auth.test.ts, automation.test.ts
│  │   ├─ tsconfig.server.json         (server build target)
│  │   ├─ vite.config.ts               (client build target)
│  │   ├─ package.json                 name: "fencepro-portal"
│  │   ├─ Dockerfile, docker-compose.yml, vercel.json
│  │   ├─ uploads/                     local-disk file storage (UPLOAD_DIR)
│  │   └─ botpress/                    Botpress chatbot integration files
│  └─ mobile/                          Empty placeholder (no app yet)
├─ packages/
│  ├─ shared/
│  │   └─ src/quoteEngine.ts           ★ Original price/labor engine (123 lines).
│  │                                   Used only by packages/api. Distinct from the
│  │                                   active estimating logic in apps/web and
│  │                                   apps/portal.
│  └─ api/                             ⚠ LEGACY — older Express server that no
│      ├─ src/index.ts                 longer runs in production. Kept because root
│      └─ src/routes/{quotes,inventory}.ts   package.json db:* scripts still target it.
├─ prisma/
│  ├─ schema.prisma                    ⚠ LEGACY (228 lines) — paired with packages/api.
│  └─ seed.ts                          NOT the active schema.
├─ deploy/                             nginx.conf, deploy.sh, setup.sh, Dockerfile
├─ fencepro-qa/                        QA workspace (untracked)
├─ pnpm-workspace.yaml                 packages: apps/*, packages/*
├─ package.json                        root: turbo, prisma 5.22.0
└─ EZBIZ_*.md, *_AUDIT.md, *.md        50+ audit / verification / setup docs
```

### "Two Prisma schemas?" — yes, but only one is live
- **Active:** `apps/portal/prisma/schema.prisma` — every model the running server uses (CrmUser, PortalAccount, Lead, Appointment, Invoice, EzBudgetQuote, QuoteBundle, QuoteOption, VendorBill, Automation, Integration, etc.). Prisma client v6.
- **Legacy:** `prisma/schema.prisma` (root) — paired with `packages/api/`. Different model shapes (uses `Decimal` columns; has `FenceStyle`, `InventoryItem`, `Quote.lineItems`). Prisma client v5. **Not running in production.** Root `package.json` `db:migrate` / `db:seed` / `db:studio` scripts point to `packages/api`, which is misleading — for the live system, use the `apps/portal` scripts (`pnpm --filter fencepro-portal db:push|seed|studio`).

---

## 3. Tech stack

| Concern | Pick |
|---|---|
| **Monorepo** | pnpm workspaces (`pnpm-workspace.yaml`) + turborepo |
| **Frontend (CRM)** | React 19, Vite 8, TailwindCSS 4, TypeScript 5.9. Custom hash-based routing inside [App.tsx](apps/web/src/App.tsx). No react-router. State management = React state + ad-hoc localStorage (`fencepro_*` keys) + custom `window.dispatchEvent('fencepro:*:updated')` for cross-component notification. |
| **Frontend (Portal)** | React 19 + Vite + Tailwind. State-based navigation in [apps/portal/src/client/App.tsx](apps/portal/src/client/App.tsx). |
| **Backend** | Node 18+, Express 5.1, Prisma Client 6.9, helmet 8, express-rate-limit 8, jsonwebtoken, bcryptjs (factor 12), multer for uploads, googleapis, zod 3 for validation. |
| **Database** | PostgreSQL. Connection via `DATABASE_URL`. Use `?sslmode=require` for managed providers. |
| **Auth** | JWT access (15 m) + refresh (7 d) for both staff (CrmUser) and customer (PortalAccount). bcrypt(12) for passwords; SHA-256 hashes for invite tokens; lockout after N failed attempts. Distinct rate-limiter (5 req / 15 min) on `/api/{crm-auth,portal}/login` and `/forgot-password`/`/activate`. |
| **Email** | SendGrid (preferred, via `SENDGRID_API_KEY`); SMTP fallback (`SMTP_HOST`/`PORT`/`USER`/`PASS`). Sender = `SMTP_FROM_EMAIL` (default `noreply@ezbiz.app`, **must be verified or all emails 403**). |
| **SMS** | Twilio (`TWILIO_ACCOUNT_SID`/`AUTH_TOKEN`/`FROM_NUMBER`). Untested with live creds. |
| **Payments** | Stripe (`STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`). Untested with live creds. |
| **Maps / Geocoding** | Google Maps JS API (`GOOGLE_MAPS_API_KEY`). |
| **Calendar** | Google Calendar OAuth (`GoogleCalendarToken` table per-rep). |
| **Storage** | Local disk at `UPLOAD_DIR` (default `./uploads`). S3 adapter stub exists at `apps/portal/src/server/lib/storage/`. |
| **Tests** | Vitest. 28+ tests in `apps/portal/tests/`. |
| **Process** | PM2, single process named `fencepro` (legacy name). |
| **Hosting** | DigitalOcean droplet for prod; nginx reverse proxy → Express on port 4000. Docker / Vercel configs also present. |
| **Observability** | console.log / console.error throughout. **No Sentry, no structured logging** (issue #22, #23 in known-issues). |

---

## 4. Database tables (active schema, `apps/portal/prisma/schema.prisma`)

Listed in semantic groups. Every model uses `String` UUIDs unless noted.

**Identity & access**
- `CrmUser` / `CrmUserSession` / `CrmUserActivity` — staff users + JWT session table + activity log. Roles: `super_admin`, `admin`, `manager`, `sales_rep`, `field_crew`, `office_staff`, `customer`. `inviteTokenHash` is reused for password reset (issue #5).
- `PortalAccount` / `PortalInvite` — customer-portal logins. Crucially has `crmCustomerId` (string) — links to a customer record that may live in localStorage on the CRM side.
- `Customer` — customer-portal-specific identity table. **Distinct from `CrmContact`** (database-backed CRM contact list). The portal's `Customer` belongs to a `CrmAccount`.
- `RefreshToken` — portal customer refresh tokens.
- `ApiKey` / `ApiKeyUsageLog` — staff-issued bearer keys.

**CRM core (database-backed where possible)**
- `CrmAccount` — top-level account / company on the portal side.
- `CrmContact` — database-backed contact records used by the CRM (recently added; legacy contacts still live in `localStorage.fencepro_customers`).
- `Lead` — chatbot/website-generated leads (Botpress integration). Has scoring, urgency, conversion tracking.
- `Appointment`, `FollowUp` — paired with Lead.

**Communication**
- `Document` — file metadata (storage path is `storagePath`).
- `Ticket` / `TicketComment` — support tickets.
- `Contract` — customer-facing contract records.
- `Invoice` — uses `amountCents` (integer cents — clean money math).
- `ChatConversation` / `ChatMessage` — assistant chat threads.
- `KnowledgeEntry` — chatbot knowledge base.

**Customer Portal data plane**
- `PortalPhoto`, `PortalFile`, `PortalMessage` — server-backed photos/docs/messages, replacing earlier localStorage-only versions.
- All three soft-delete via `deletedAt`.

**Quoting (next-gen)**
- `QuoteBundle` / `QuoteBundleInclusion` / `QuoteBundleAddon` — Good/Better/Best bundles with override knobs. ⚠ Has `Float` columns for `marginOverride`, `laborRateOverride`, `materialMarkupPercent` (issue #3).
- `QuoteOption` — per-quote computed bundle option (cents-integer everywhere except `marginPercent` which is Float).
- `EzBudgetService` / `EzBudgetQuote` / `EzBudgetLineItem` / `EzBudgetSettings` — public-widget instant-quote module (cents-integer money throughout).
- `PricingRule` — fence-type → cents per linear foot lookup for the chatbot pricing endpoint.

**Operations & inventory**
- `Job` / `JobChecklistItem` — operational jobs and milestone checklist.
- `InventoryPendingOrder` / `InventoryPendingOrderItem` — restock queue spawned when a quote is sold.

**Finance (cents-integer end to end)**
- `VendorContact`, `VendorBill`, `VendorBillLineItem`, `VendorPayment` — AP.
- `PlManualEntry` — manual P&L lines.
- `BalanceSheetEntry` — balance sheet entries.

**Automation engine**
- `Automation`, `AutomationRunLog` — trigger types include `sales_stage_change`, `ops_stage_change`, `quote_sold`, `invoice_created`, `customer_no_response`, `rain_day_flagged`, `payment_received`, `stale_job`, `deadline_approaching`. Action types include `send_email`, `send_sms`, `move_ops_stage`, `move_sales_stage`, `create_task`, `fire_webhook`, `require_checklist_gate`, `post_activity_note`. 28 vitest tests pass.
- `Task` (created by automations or manually).
- `Notification` — in-app notifications.

**Integration framework**
- `Integration` / `IntegrationLog` — generic adapter records (twilio, google_calendar, stripe, companycam, connecteam, quickbooks, zapier).
- `WebhookInboundLog` — every inbound webhook is logged.

**Audit / monitoring**
- `AuditLog` — portal-side, tied to `Customer`.
- `CrmAuditLog` — staff-side CRUD audit; before/after JSON for reversibility.
- `BackupLog` — every backup attempt.
- `MonitoringSnapshot` — daily entity counts; drives `/api/health` and the daily anomaly alert.
- `GoogleCalendarToken` — OAuth tokens per rep.

**Migrations.** No `prisma/migrations/` directory ships in the repo. The deploy flow uses `prisma db push --accept-data-loss` (see [EZBIZ_SETUP_GUIDE.md](EZBIZ_SETUP_GUIDE.md) §"Deploying a new version"). Treat the live DB as the source of truth and back up before changing the schema.

---

## 5. API surface (active server, `apps/portal/src/server`)

Mounted in [apps/portal/src/server/index.ts](apps/portal/src/server/index.ts):

| Mount | File | Purpose |
|---|---|---|
| `/api/auth/*` | [routes/auth.ts](apps/portal/src/server/routes/auth.ts) | Customer-portal login/refresh |
| `/api/crm-auth/*` | [routes/crm-auth.ts](apps/portal/src/server/routes/crm-auth.ts) | Staff (CrmUser) login + password reset |
| `/api/portal/*` | [routes/portal.ts](apps/portal/src/server/routes/portal.ts) | Portal accounts: invite/activate/login + photos / documents / messages (the customer-portal data plane). 25+ endpoints. |
| `/api/dashboard/*` | dashboard.ts | KPIs |
| `/api/tickets/*` | tickets.ts | Ticket CRUD |
| `/api/invoices/*` | invoices.ts | Invoice CRUD |
| `/api/documents/*` | documents.ts | Generic document CRUD; rate-limited |
| `/api/contracts/*` | contracts.ts | Contract CRUD |
| `/api/admin/*` | admin.ts + admin-audit.ts | Admin tools + audit-log query |
| `/api/sync/*` | sync.ts | CRM ↔ portal sync helpers |
| `/api/chat/*` | chat.ts | Customer chat |
| `/api/leads/*` | leads.ts | Lead CRUD (Botpress + manual) |
| `/api/lead-chat/*` | lead-chat.ts | Botpress webhook in |
| `/api/appointments/*` | appointments.ts | Lead appointments |
| `/api/pricing-rules/*` | pricing.ts | Fence-type pricing for chatbot |
| `/api/quotes/*` | quotes-api.ts | Quote-engine API (server-side calculation) |
| `/api/knowledge/*` | knowledge.ts | KB entries for chatbot |
| `/api/google-calendar/*` | google-calendar.ts | Calendar OAuth + sync |
| `/api/ez-budget/*` | ez-budget.ts | Public widget endpoints + admin (separate exports) |
| `/api/automations/*` | automations.ts | Automation rules CRUD + run-log |
| `/api/integrations/*` | integrations.ts | Integration registry |
| `/api/crm-contacts/*` | crm-contacts.ts | DB-backed CRM contacts |
| `/api/cron/*` | cron.ts | Vercel-style cron (e.g. follow-ups) |
| `/api/health`, `/api/health/storage` | inline | DB ping + counts + last-backup metadata; storage write/read/delete probe |

**Auth-by-header conventions:**
- Customer (portal user) routes: `Authorization: Bearer <accessToken>`.
- Staff-side endpoints called from the CRM: `X-API-Key: <CRM_SYNC_KEY>` (32-byte hex env var).

**Rate limits.**
- `/api/*` — 100 req/min per IP.
- `/api/auth/login`, `/api/crm-auth/login`, `/api/crm-auth/forgot-password`, `/api/portal/login`, `/api/portal/activate` — 5 per 15 min.
- `/api/documents` (uploads) — 10 per hour.

---

## 6. Frontend "router" map

Neither frontend uses react-router. Both use `useState` + URL-hash sniffing.

### CRM ([apps/web/src/App.tsx](apps/web/src/App.tsx))

Top-level hash routes (no auth):
- `#/present/:token` → `<PublicPresentationPage>` (a public Good/Better/Best presentation)
- `#/quote/:token` → `<PublicQuotePage>` (a single-quote share link)
- `#/portal/:route` → `<CustomerPortalApp>` (in-process customer portal embedded in the CRM)

Otherwise, an `AuthGate` enforces login (CrmUser via `/api/crm-auth`) and renders `<AppShell>`, which switches on a single `active` state variable. NAV groups + roles:

- **Sales:** Sales Pipeline, Dashboard, Customers, Quotes
- **Operations:** Operations, Schedule, Dispatch, Site Plans, Inventory
- **Finance:** P&L Statement, Balance Sheet, Cash Flow (placeholder), Billing, Accounts Payable, Vendors, Reports, Budget
- **Admin:** Team, Bundles, EZ Budget, Automations, Integrations, Portal, Audit Log, Settings

Each item is gated by role (`owner` / `admin` / `salesman` / `ops_manager` / `shop`). The mapping from server `CrmUser.role` → CRM `UserRole` happens in `AuthGate` ([App.tsx:232](apps/web/src/App.tsx#L232)).

54 page-component files live in [apps/web/src/](apps/web/src/) (one per nav item plus modals: QuoteBuilder, MapQuoteBuilder, SitePlanTool, SmartSchedule, BulkImportModal, etc.).

### Customer Portal ([apps/portal/src/client/App.tsx](apps/portal/src/client/App.tsx))

`PortalRouter` switches on a `page` state: `dashboard`, `tickets`, `invoices`, `documents`, `contracts`, `knowledge`, `admin`. `<ChatWidget>` shows for customer-role users; `<LeadChatWidget>` shows on the public login page.

---

## 7. The estimating engine — where it lives, what it does

This is fence-specific and the most domain-rich code in the repo. It exists in **three implementations** that share formulas but live in different layers.

### 7.1 `apps/web/src/materialCalculator.ts` (550 lines) — the bill-of-materials calculator
The **authoritative line-item generator.** Replicates an Excel "EZ-Quote" workbook. For a job (style + run lengths + corners/ends + walk gates + double gates + tear-out counts) it produces a `LineItem[]` pull-sheet with item name, qty, unit cost, total. Style branches: Vinyl White ND/DS, Vinyl Tan ND/DS (6×6, 6×8, 8×6, 8×8, Bell), Chainlink Galv (4'/5'/6'), Chainlink Black (4'/5'/6'), Commercial Chainlink (with optional `+1'` barb arms), Aluminum Emily ND/DS, Durafence. Per-style logic computes posts, panels, fabric rolls, tension bars, hardware counts, gate hardware, concrete bags, etc. Fence-style names are the join key — change them and you break this file.

### 7.2 `apps/web/src/QuoteBuilder.tsx` (756 lines) — the in-CRM quote UI + pricing
Modal that drives the new-quote flow. Reads pricing config (`manHourRate`, `tearOutFence`, `tearOutGate`, commission rates) from `getConfig()` ([configStore.ts](apps/web/src/configStore.ts)). For each run:
1. Compute sections from run lengths + style's `panelWidth` (run is integer-sectioned with ceiling).
2. Call `calculateMaterials()` to get the pull-sheet + material total.
3. Compute `baseMH = sections / sectionsPerMH + walkGates*2.4 + dblGates*4.8`; `adjMH = baseMH + adjLaborHrs`.
4. `laborCost = adjMH * manHourRate`; `tearOutCost = sections*9.50 + gates*27`; `totalCOGS = material + labor + tearOut`.
5. `basePrice = totalCOGS / margin` (style-specific magic-number; vinyl 0.64, chainlink 0.56, etc.).
6. `adjustedPrice = basePrice * (1 + priceAdjust)` (`priceAdjust` clamped −0.20…+0.20).
7. Commission and gross-margin computation.
8. Save flow: `localStorage.fencepro_quotes`, plus an automated job-creation + pending-order on first SOLD (see [App.tsx:367](apps/web/src/App.tsx#L367)).

### 7.3 `apps/web/src/bundleEngine.ts` (138 lines) — Good/Better/Best bundles
Takes a `QuoteBundle` (DB-backed) + the same job inputs and produces a `QuoteOption` (saved to the `QuoteOption` table). Three pricing methods: `calculated` (= COGS / margin), `price_per_foot` (overrides), `markup_percent` (margins on materials only). Produces presentation-ready snapshots (`inclusionSnapshot`, `addonSnapshot`).

### 7.4 `apps/portal/src/server/lib/quoteEngine.ts` (572 lines) — server-side mirror
Same formulas as web/materialCalculator.ts + QuoteBuilder, but on the server. Used by Botpress chatbot quotes and by `/api/quotes/*` so chatbot quotes match CRM quotes. Has its own copy of `FENCE_STYLES` (kept in sync manually).

### 7.5 `apps/web/src/EZBudgetPage.tsx` (492 lines) — instant-quote widget admin
Admin UI for the public `/ez-budget` endpoint (PricingRule + EzBudgetService + EzBudgetQuote). Used to set per-foot pricing for the public lead-gen widget. Trade-agnostic at the schema level.

### Where fence-style data lives (4 places — keep in sync!)
1. **CRM defaults:** [apps/web/src/configStore.ts](apps/web/src/configStore.ts) `DEFAULT_FENCE_STYLES` (26 styles: id, name, category, margin, sectionsPerMH, panelWidth, mhPerWalkGate, mhPerDblGate, isActive). Saved to `localStorage.fencepro_config`.
2. **CRM hardcoded fallback:** the same array re-listed at top of [QuoteBuilder.tsx:10](apps/web/src/QuoteBuilder.tsx#L10) (in case the localStorage config is missing).
3. **Server-side mirror:** [apps/portal/src/server/lib/quoteEngine.ts:75](apps/portal/src/server/lib/quoteEngine.ts#L75) `FENCE_STYLES`.
4. **Legacy DB table:** `FenceStyle` model in `prisma/schema.prisma` (root, used by `packages/api` only).

If you add a fence style, update at least #1 and #3. Material-calculator branches in [materialCalculator.ts](apps/web/src/materialCalculator.ts) match by name string (e.g. `"WV-ND 6'x6' Privacy"`), so the name is a load-bearing key.

### Inventory (master list of items + costs)
- **CRM seed:** [apps/web/src/inventoryStore.ts](apps/web/src/inventoryStore.ts) `DEFAULT_INVENTORY` (~250+ items: posts, panels, gates, hardware, concrete, fabric, etc., with `unitCost`, `category`, optional stock-tracking fields). Saved to `localStorage.fencepro_inventory`.
- **DB-backed inventory pending orders:** `InventoryPendingOrder` in the active schema — created automatically when a quote is sold, lists what to procure.
- **Legacy DB inventory:** `InventoryItem` in the legacy root schema, unused at runtime.

---

## 8. Environment variables

See [EZBIZ_SETUP_GUIDE.md §"Required environment variables"](EZBIZ_SETUP_GUIDE.md). Hard requirements that crash startup if absent: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`. The portal validates env at startup via `printEnvValidation()` in [server/lib/urls.ts](apps/portal/src/server/lib/urls.ts).

| Required | Recommended | Optional |
|---|---|---|
| `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRY` (15m), `JWT_REFRESH_EXPIRY` (7d), `PORT` (4000), `CLIENT_URL`, `NODE_ENV`, `CRM_SYNC_KEY`, `CRM_PROVIDER` (`fencepro`) | `COMPANY_NAME` (white-label brand), `SMTP_FROM_EMAIL` (must be verified in SendGrid), `SENDGRID_API_KEY` | `APP_URL`, `SMTP_FROM`, `SMTP_HOST/PORT/USER/PASS`, `TWILIO_*`, `STRIPE_*`, `OPENWEATHER_API_KEY`, `GOOGLE_MAPS_API_KEY`, `CORS_ORIGINS`, `UPLOAD_DIR`, `STORAGE_DRIVER`, `S3_*`, `STRICT_ENV_VALIDATION` |

---

## 9. Architectural decisions worth knowing about

1. **Single PM2 process serves the API + the portal client; nginx serves the CRM dist statically.** Deploy path on the droplet is `/var/www/fencepro/{repo,portal,web}` — kept as `fencepro` for backward compatibility.
2. **Two languages of "customer".** `Customer` (portal-side login identity) and `CrmContact` (DB-backed CRM contacts) coexist. Many CRM contacts still live in `localStorage.fencepro_customers` because the multi-tenant rewrite is pending (issue #1).
3. **Multi-tenancy is NOT implemented.** Each browser is its own tenant. Most user data (customers, quotes, jobs, pipeline, inventory, schedules, billing, invoices, vendor bills) lives in `localStorage.fencepro_*`. Server-side tables that are real: auth (CrmUser, PortalAccount), portal data plane (photos/files/messages), leads, finance (vendor bills, invoices), automations, integrations. Don't assume a `companyId` filter exists anywhere.
4. **localStorage keys are sacred.** Renaming `fencepro_*` would wipe all user data on next page load. Any rename must include a migration step.
5. **Money math is mixed.** Cents-integer in finance / billing / vendor bills / EZ Budget. Float in `QuoteBundle.marginOverride`, `laborRateOverride`, `materialMarkupPercent`, `QuoteOption.marginPercent`, frontend `POLineItem.unitCost/total` (issue #3).
6. **Soft-delete is inconsistent.** `Document`, `PortalPhoto`, `PortalFile`, `PortalMessage` use `deletedAt`. `Ticket`, `Invoice`, `Contract`, `Customer`, `Lead`, `Appointment` do NOT (issue #19).
7. **No code-splitting yet.** CRM bundle is monolithic ~1.16 MB minified (issue #4).
8. **Hash-based "routing".** Both frontends use `useState`+`window.location.hash` instead of react-router. Deep links work via `#/present/:token`, `#/quote/:token`, `#/portal/:route` only.
9. **No Sentry / structured logging.** All error capture is via `console.error`. Add request-id / Sentry when this becomes painful (issues #22, #23).
10. **CSP is intentionally disabled** in helmet config (inline styles + Google Maps + SendGrid pixels). Fix is queued (issue #6).

---

## 10. Feature modules at a glance

| Module | Frontend entry | Backend tables | Server routes | Notes |
|---|---|---|---|---|
| Auth (staff) | LoginPage.tsx + crmAuth.ts | CrmUser, CrmUserSession | /api/crm-auth | bcrypt(12), lockout, JWT rotation |
| Auth (portal customer) | apps/portal/src/client/LoginPage.tsx | PortalAccount, RefreshToken | /api/portal, /api/auth | SHA-256 invite tokens |
| Sales pipeline | SalesPipelineBoard.tsx | (localStorage `fencepro_pipeline`) | — | Stages configurable via Settings |
| Customers (CRM) | CustomersPage.tsx, CustomerForm | CrmContact (+ `fencepro_customers` LS) | /api/crm-contacts | Tax fix on invoices: 100× bug fixed in CustomersPage line ~473 |
| Quote builder | QuoteBuilder.tsx, QuoteOptionsPanel.tsx, MapQuoteBuilder.tsx | QuoteBundle, QuoteOption, EzBudgetQuote | /api/quotes, /api/ez-budget | See §7 |
| Jobs / Operations | OperationsBoard.tsx, OperationsPage.tsx, JobsPage.tsx, JobsPipeline.tsx | Job, JobChecklistItem (+ `fencepro_jobs` LS) | — | Vertical-swimlane redesign live |
| Schedule / Dispatch | SchedulePage.tsx, DispatchPage.tsx, SmartSchedule.tsx | Appointment, GoogleCalendarToken | /api/appointments, /api/google-calendar | Weather widget needs OPENWEATHER_API_KEY |
| Site plans | SitePlansPage.tsx, SitePlanTool.tsx | (localStorage) | — | Drawing tool + storage |
| Inventory | InventoryPage.tsx, inventoryStore.ts, PendingOrdersPage.tsx | InventoryPendingOrder | — | LS for catalog, DB for pending orders |
| Bundles | BundlesPage.tsx, bundleStore.ts, bundleEngine.ts | QuoteBundle, QuoteBundleInclusion, QuoteBundleAddon, QuoteOption | (in /api/quotes) | Good/Better/Best tiers |
| EZ Budget | EZBudgetPage.tsx, EZBudgetWidget.tsx | EzBudgetService, EzBudgetQuote, EzBudgetLineItem, EzBudgetSettings, PricingRule | /api/ez-budget (public + admin) | Public widget for instant quotes |
| Billing / AR | BillingPage.tsx, billingStore.ts | Invoice, (localStorage payments/pull-sheets) | /api/invoices | Cents-integer; Stripe webhook untested |
| Vendors / AP | VendorsPage.tsx, AccountsPayablePage.tsx, vendorStore.ts | VendorContact, VendorBill, VendorBillLineItem, VendorPayment | (admin routes) | Cents-integer |
| P&L | PLStatementPage.tsx, plEngine.ts | PlManualEntry | (admin) | |
| Balance Sheet | BalanceSheetPage.tsx | BalanceSheetEntry | (admin) | |
| Reports | ReportsPage.tsx | derived from quotes | — | |
| Budget | BudgetPage.tsx | (localStorage `fencepro_budget`) | — | Magic number, overhead %, labor/materials/profit targets |
| Automations | AutomationsPage.tsx, automationTrigger.ts | Automation, AutomationRunLog, Task | /api/automations | 28 vitest tests pass |
| Integrations | IntegrationsPage.tsx | Integration, IntegrationLog, ApiKey, ApiKeyUsageLog, WebhookInboundLog | /api/integrations | Stripe, Twilio, Google Calendar, QuickBooks, CompanyCam, Connecteam — most untested live |
| Customer portal (in CRM) | CustomerPortalApp.tsx, PortalInbox.tsx, MessagesInbox.tsx | PortalAccount, PortalPhoto, PortalFile, PortalMessage | /api/portal | The CRM has a "Portal" nav that mirrors what the customer sees |
| Customer messages | CustomerMessagesTab.tsx | PortalMessage | /api/portal/messages, /api/portal/customer/:id/messages | |
| Customer photos / files | CustomerPhotosTab.tsx, CustomerFilesTab.tsx | PortalPhoto, PortalFile | /api/portal/{photos,documents,...} | |
| Lead generation | (Botpress webhook + LeadChatWidget in portal) | Lead, Appointment, FollowUp, KnowledgeEntry, PricingRule | /api/leads, /api/lead-chat, /api/knowledge, /api/pricing-rules | Lead scoring in lib/leadScoring.ts |
| Audit log | AuditLogPage.tsx | CrmAuditLog | /api/admin/audit-log | Before/after JSON for reversibility |
| Admin / Settings | AdminPage.tsx, AdminSettingsPage.tsx, EmailTemplatesSettings.tsx, OperationsStagesSettings.tsx, ContractTemplatesSettings.tsx, PortalQuoteSettings.tsx | (localStorage `fencepro_config`) | (admin) | Where to set company info, fence styles, pricing, pipeline stages, email templates |
| Public-facing pages | PublicPresentationPage.tsx, PublicQuotePage.tsx | QuoteOption (shareToken) | /api/quotes (public) | `#/present/:token`, `#/quote/:token` — no auth |

---

## 11. Known issues — quick reference

Full detail in [EZBIZ_KNOWN_ISSUES.md](EZBIZ_KNOWN_ISSUES.md). Triage:

- **P0** — #1 multi-tenant isolation not implemented; #8 SendGrid sender unverified (all emails 403 → mailto fallback).
- **P1** — #3 float-money columns; #9 Stripe webhook untested.
- **P2** — #2 trade-agnostic terminology; #4 monolithic bundle; #5 invite/reset token field reuse; #10 QuickBooks OAuth untested; #11 Twilio SMS untested; #12 other integrations untested; #13 payment-recording UI doesn't refresh; #15 modals not full-screen on mobile; #18 missing onDelete behaviors; #23 no Sentry.
- **P3** — #6 CSP disabled; #7 refresh-token reuse window; #14 no save spinner; #16 input validation; #17 inconsistent empty states; #19 inconsistent soft-delete; #20 orphan-detection script not implemented; #21 /health version field; #22 unstructured logs.

Audit summary lives at [EZBIZ_AUDIT_SUMMARY.md](EZBIZ_AUDIT_SUMMARY.md) (1 critical fixed, 5 production-config gaps tightened).

---

## 12. How to start a new Claude Code session safely

1. **Read these four docs first** (already part of any onboarding):
   - [EZBIZ_SETUP_GUIDE.md](EZBIZ_SETUP_GUIDE.md) — deploy + env vars + first-login checklist
   - [EZBIZ_AUDIT_SUMMARY.md](EZBIZ_AUDIT_SUMMARY.md) — what was audited, what was fixed, what was NOT
   - [EZBIZ_WHITELABEL_GUIDE.md](EZBIZ_WHITELABEL_GUIDE.md) — what's brandable today
   - [EZBIZ_KNOWN_ISSUES.md](EZBIZ_KNOWN_ISSUES.md) — prioritized issue list
   - And this file: **EZBIZ_PROJECT_CONTEXT.md**.
2. **Verify state before acting on memory.** Memories from prior sessions can go stale: a file that was named X may be renamed; a flag may have been removed. Before recommending or editing, `Glob` the path and `Grep` the symbol.
3. **Don't rename `fencepro_*` localStorage keys.** It will wipe user data on next page load.
4. **Don't rename the PM2 process or `/var/www/fencepro/` deploy path** unless you're also rewriting the nginx config + PM2 ecosystem at the same time.
5. **Treat the LIVE Postgres as the source of truth.** No `prisma/migrations/` folder ships here. Before any schema change: take a backup (`apps/portal/scripts/pre-deploy-backup.ts`), then `prisma db push`. Always test on staging if available.
6. **Don't trust `prisma/schema.prisma` at the repo root.** It's the legacy schema for `packages/api`, not the production schema. Use `apps/portal/prisma/schema.prisma`.
7. **Estimating-engine changes touch 3+ files.** A new fence style means: configStore.ts (defaults), QuoteBuilder.tsx (fallback list), server/lib/quoteEngine.ts (server mirror), and possibly materialCalculator.ts (per-style branch). The fence-style **name** is the join key — don't rename casually.
8. **Money columns: prefer cents-integer for new code.** Float-money columns exist in QuoteBundle / QuoteOption / POLineItem and should not be expanded.
9. **No multi-tenant filter anywhere yet.** When writing new server code, design with a future `companyId` filter in mind, but don't add stub fields until issue #1 is resolved.
10. **Frontend "routing" is hash + state.** Don't introduce react-router for one-off changes; follow the existing pattern in App.tsx.
11. **Run tests where you can.** `pnpm --filter fencepro-portal test` runs vitest (auth + automation suites). The CRM has no test suite yet — type-check with `cd apps/web && pnpm exec tsc --noEmit -p tsconfig.app.json`.
12. **Confirm scope before destructive ops** — git resets, `prisma migrate reset`, deleting the uploads directory, force-pushing. The user expects explicit confirmation per issue.
13. **The user is Jonathan (Getter Done Fence, FL).** Customer-facing brand for his own tenant is "Getter Done Fence", not EZBiz. EZBiz is the SaaS platform; Getter Done is one tenant. Other future tenants will set their own brand via Settings → Company Info.
14. **Today's date / scheduling.** The /loop scheduling tools are available, but there is no recurring task expected by default. Don't schedule anything without an explicit ask.

---

## 13. Local dev quickstart

```bash
# from repo root
pnpm install

# Active server + portal client
cd apps/portal
cp .env.example .env       # fill in DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, CRM_SYNC_KEY
pnpm db:push               # syncs the active schema
pnpm db:seed               # optional sample data
pnpm dev                   # concurrently runs server (port 4000) + portal client (port 5174)

# CRM, in a second terminal
cd apps/web
pnpm dev                   # CRM at port 5173

# Tests
pnpm --filter fencepro-portal test
```

Health check: `curl http://localhost:4000/api/health` → expect `status: ok`, db ping, last-backup, email status.

---

_End of context document. If anything in this file no longer matches reality, update it — don't carry the drift forward into a memory file._
