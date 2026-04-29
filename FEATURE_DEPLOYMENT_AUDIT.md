# Feature Deployment Audit
**Date:** 2026-04-29

This document maps every feature claimed by recent prompts to (a) where it lives in the source tree, and (b) whether it's currently visible on the live site at systemssyndicate.com.

Legend: ✅ source-tree complete · 🚀 deployed live · ❌ not in source / not deployed · ⚠️ partial

---

## Phase 4 — UI visibility (sidebar nav + page routing)

### Sidebar items currently visible on the live site

Captured by Playwright walking the post-login page:

```
🔨 Sales Pipeline · 📊 Dashboard · 👥 Customers · 📋 Quotes · 🔧 Operations · 📅 Schedule
📍 Dispatch · 🗺 Site Plans · 📦 Inventory · 📊 P&L Statement · 📑 Balance Sheet · 💸 Cash Flow
💳 Billing · 🧾 Accounts Payable · 🏢 Vendors · 📈 Reports · 💰 Budget · 👥 Team · 📦 Bundles
💲 EZ Budget · ⚡ Automations · 🔌 Integrations · 🌐 Portal · ⚙️ Settings · 🔍 Search…
```

Cross-checked against the spec list — **every nav item the prompt asked about is already on the live site.** No missing nav links.

### Routes that resolve

The web app uses state-driven routing (`setActive('Customers')` etc.) inside `App.tsx`, not URL paths. Every nav button maps to a `setActive(<name>)` and renders the corresponding page component. The earlier QA pass walked all 15+ items and none returned a blank page or 404.

The portal app uses hash routes (`/#/portal/...`). The handler in `App.tsx` recognizes `#/present/:token` and `#/portal/...` and switches to `PortalPresentationPage` / `CustomerPortalApp`. Probed live: `/portal/login` → 200, `/portal/activate` → 200.

### Routes the spec list mentions that aren't real URL paths in this app

The spec asked to verify URL routes like `/customers/:id`, `/quotes/new`, `/admin/team`, `/admin/settings/email-templates`, etc. **This app does not use URL routing for the CRM.** Those names are *page names* that surface via `setActive`. Visiting `https://systemssyndicate.com/customers/123` directly does *not* work — the app router doesn't read URLs. That is the existing architecture, not a regression. The portal half (`/portal/...`) does use real hash routes.

If the user wants real URL routing they'd need to introduce React Router into `apps/web/src/App.tsx`. That is a substantial change and is **out of scope** for this audit — flagged for follow-up.

---

## Phase 5 — API endpoint registration audit

| Endpoint | Live status | Source state |
|---|---|---|
| `POST /api/crm-auth/login` | ✅ 400 with empty body (route exists) | unchanged |
| `POST /api/crm-auth/refresh` | ✅ exists | unchanged |
| `POST /api/crm-auth/forgot-password` | ✅ exists | uses new `buildFrontendUrl()` |
| `POST /api/crm-auth/reset-password` | ✅ exists | unchanged |
| `POST /api/crm-auth/accept-invite` | ✅ exists | unchanged |
| `POST /api/crm-auth/invite` | ✅ exists | rewritten to use `buildFrontendUrl()` + `disableClickTracking: true` |
| `POST /api/crm-auth/invite/:userId/resend` | ❌ 404 live | ✅ NEW in source — needs deploy |
| `POST /api/crm-auth/invites/resend-all-pending` | ❌ 404 live | ✅ NEW in source — needs deploy |
| `GET/POST/PATCH/DELETE /api/crm-contacts` | ❌ 404 live | ✅ NEW in source — needs deploy |
| `POST /api/crm-contacts/sync` | ❌ 404 live | ✅ NEW in source — needs deploy |
| `POST /api/portal/login` | ✅ exists | unchanged |
| `POST /api/portal/activate` | ✅ exists | unchanged |
| `POST /api/portal/invite` | ✅ exists | rewritten to use `buildFrontendUrl()` + `disableClickTracking: true` |
| `POST /api/sync/customers` | ✅ exists | unchanged |
| `POST /api/sync/quotes` | ✅ exists | unchanged |
| `POST /api/sync/invoices` | ✅ exists | unchanged |

Routes the spec list mentions that **don't exist yet** (and weren't built in any prior prompt — surfacing here so they don't get lost):

| Endpoint | Status |
|---|---|
| `GET/POST /api/customers`, `PUT /api/customers/:id` | ❌ Not built. The CRM uses localStorage for customer data. The new `/api/crm-contacts` is the database-backed replacement (different name on purpose so the existing portal `Customer` model — which is the customer-portal login user — isn't confused with CRM contact records). |
| `GET/POST /api/quotes` etc. | ❌ Not built for the CRM. The portal has `/api/quotes-api` for portal-facing quote viewing, not for CRM CRUD. |
| `GET/POST /api/jobs`, `PATCH /api/jobs/:id/stage`, `GET /api/jobs/:id/checklist` | ❌ Not built. Jobs live in localStorage. |
| `GET/POST /api/pipeline/deals`, `GET /api/pipeline/stages` | ❌ Not built. Pipeline lives in localStorage. |
| `GET /api/operations/stages` | ❌ Not built. Stages are hardcoded in `OPS_STAGES`. |
| `GET/POST /api/invoices` etc. | ❌ Existing `Invoice` Prisma model is sync-only, not CRUD-from-CRM. |
| `GET/PUT /api/settings/company`, `GET /api/settings/pipeline-stages` | ❌ Settings live in localStorage. |

These are documented in [DATA_STORAGE_ARCHITECTURE.md §3](DATA_STORAGE_ARCHITECTURE.md#3-localstorage--what-still-lives-there-and-what-to-do-about-it) as the next-step migration list. The pattern established by `crm-contacts.ts` is the template for each.

---

## Phase 6 — Database connectivity / migrations

### Live DB

The live API process clearly has a working PostgreSQL connection — login works, which requires reading `CrmUser` rows. So the DB is up and queryable.

### Pending migrations

The new `CrmContact` model added to [`apps/portal/prisma/schema.prisma`](apps/portal/prisma/schema.prisma) requires a migration to be applied to the production database. The migration is **purely additive** (one new table, no ALTERs on existing columns), so applying it is safe.

```bash
# After deploy, on the production VPS:
cd apps/portal
npx prisma migrate deploy
# → applies any pending migrations (currently: add_crm_contact)
```

### Schema-vs-code drift check (after deploy)

```bash
npx prisma migrate status
# Should print: "Database schema is up to date!"
```

---

## Phase 7 — Frontend asset delivery

### Cache busting

Vite produces hashed filenames by default:
```
dist/assets/index-BLdi1tO3.js     ← local fresh build
```
Live site:
```
<script type="module" src="/assets/index-C221DKPI.js"></script>
```

Different hashes ⇒ browsers will automatically download the new bundle once nginx is serving the new `index.html`. **No stuck-cache problem.**

### Service worker

There is no `service-worker.js` / `sw.js` in `apps/web/public/` or in `dist/`. The app does not register a service worker. So there's no SW cache to purge.

### CDN / nginx

The live `Server: nginx/1.24.0 (Ubuntu)` indicates a self-hosted VPS, no Cloudflare/CloudFront edge caching to worry about. Nginx serves the static files directly from disk — once the new `dist/` is in place, the next request gets the new files.

If the user later puts Cloudflare in front of this:
```bash
# Cloudflare cache purge after deploy
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

---

## Phase 8 — Missing-feature push

| Page / feature | In nav? | Source state | Action |
|---|---|---|---|
| P&L Statement | ✅ visible (📊 P&L Statement) | Modified locally, not deployed | Deploy |
| Balance Sheet | ✅ visible (📑 Balance Sheet) | Modified locally, not deployed | Deploy |
| Cash Flow Projections | ✅ visible (💸 Cash Flow) | Pre-existing | — |
| Accounts Payable | ✅ visible (🧾 Accounts Payable) | Modified locally, not deployed | Deploy |
| Vendors | ✅ visible (🏢 Vendors) | Pre-existing | — |
| Bundle Manager | ✅ visible (📦 Bundles) | Pre-existing | — |
| Email Templates | Inside Settings — confirmed in code (`AdminSettingsPage.tsx`) | unchanged | — |
| Contract Terms | Inside Settings | unchanged | — |
| Quote Settings | Inside Settings (modified — see `QuoteDetailDrawer.tsx`) | not deployed | Deploy |
| Portal Settings | ✅ visible (🌐 Portal) | Modified locally, not deployed | Deploy |
| API Keys | Inside Admin/Settings (confirmed) | unchanged | — |
| Portal Accounts | Inside Team / Customer profile (Send Portal Invite button) | unchanged | — |
| Inventory Sales Orders | Inside Inventory page tabs | unchanged | — |
| Inventory Operations | Inside Inventory page tabs | unchanged | — |
| Operations Stages settings | Inside Settings | unchanged | — |
| Pipeline Stages settings | Inside Settings | unchanged | — |

**No feature listed in Phase 8 is missing from the source tree.** Everything either is already in nav, lives inside a Settings sub-section, or is in code awaiting deployment. After deploy, every item is visible at the URL/state indicated.

---

## Net summary

What's deployed vs. what's ready to deploy:

| Bucket | Count | Examples |
|---|---|---|
| ✅ Live and working | ~80% of features | login, customer list, portal, quotes (with the empty-Fence-Style caveat), invoices, vendors, bundles, automations, integrations, settings, email service, customer portal end-to-end |
| 🚀 Built and ready, awaiting deploy | New SalesPipelineBoard, OperationsBoard, CrmContact API, SendGrid click-tracking fix, env validator, EZBiz rename | every uncommitted file in `git status` |
| ❌ Not built — flagged for future migration | API-backed persistence for quotes/jobs/invoices/vendors/settings | tracked in DATA_STORAGE_ARCHITECTURE.md |

The single action that flips the entire 🚀 column to ✅: run [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md).
