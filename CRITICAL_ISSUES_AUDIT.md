# Critical Issues Audit
**Date:** 2026-04-28
**Scope:** url4845 SSL bug · contacts not saving · data persistence audit

---

## 1. APP_URL / CLIENT_URL — current state

The codebase uses **`CLIENT_URL`** (not `APP_URL`) for the CRM frontend domain.

| File | Line | What it does |
|---|---|---|
| [apps/portal/src/server/routes/crm-auth.ts](apps/portal/src/server/routes/crm-auth.ts#L20) | 20 | `const CLIENT_URL = process.env.CLIENT_URL \|\| 'http://localhost:5173'` |
| [apps/portal/src/server/routes/crm-auth.ts](apps/portal/src/server/routes/crm-auth.ts#L297) | 297 | Team-member invite URL: `${CLIENT_URL}/accept-invite?token=${rawToken}&email=${encodeURIComponent(email)}` |
| [apps/portal/src/server/routes/crm-auth.ts](apps/portal/src/server/routes/crm-auth.ts#L420) | 420 | Password reset URL: `${CLIENT_URL}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}` |
| [apps/portal/src/server/routes/google-calendar.ts](apps/portal/src/server/routes/google-calendar.ts#L21) | 21 | Same pattern (gcal connect redirect) |
| [apps/portal/src/server/routes/portal.ts](apps/portal/src/server/routes/portal.ts#L113) | 113 | Customer-portal email links: `process.env.APP_URL \|\| process.env.PORTAL_APP_URL \|\| process.env.CLIENT_URL \|\| 'https://systemssyndicate.com'` |
| [apps/portal/src/server/routes/portal.ts](apps/portal/src/server/routes/portal.ts#L962) | 962 | Hardcoded `process.env.APP_URL \|\| 'https://systemssyndicate.com'` |
| [apps/portal/src/server/index.ts](apps/portal/src/server/index.ts#L35) | 35 | CORS allowed origin |
| [apps/portal/src/server/lib/crm/adapters/fencepro.ts](apps/portal/src/server/lib/crm/adapters/fencepro.ts#L6) | 6 | `CRM_BASE_URL` for the adapter (different concern) |

**Inconsistency:** Three different env vars (`APP_URL`, `PORTAL_APP_URL`, `CLIENT_URL`) plus a hardcoded fallback `https://systemssyndicate.com` are sprinkled across 6 files. This is the symptom; the actual SSL bug is unrelated.

---

## 2. Root cause of `url4845.www.systemssyndicate.com`

**This is not a bug in our URL construction.** The activation email *is* sent with `https://systemssyndicate.com/accept-invite?token=...` — that's what `${CLIENT_URL}/accept-invite?token=...` produces in production.

The `url4845.www.systemssyndicate.com` prefix is **SendGrid click tracking**. SendGrid scans every outgoing email for `<a href="...">` tags and rewrites the URL through their click-tracking domain so they can record which links recipients click. The pattern:

```
Original:  https://systemssyndicate.com/accept-invite?token=ABC
Rewritten: https://url4845.www.systemssyndicate.com/ls/click?upn=...
```

The `url4845.www.systemssyndicate.com` is a SendGrid-issued tracking subdomain. It produces the SSL error because **either**:
- The custom CNAME is configured on `www.systemssyndicate.com` but the SSL certificate hasn't propagated, OR
- Link branding was set up with mismatched DNS records, OR
- The default SendGrid tracking host (`url.ct.sendgrid.net`) is being CNAME'd to the wrong target.

**The fix that works regardless of DNS state:** disable click tracking on a per-message basis for transactional/security-critical emails (invites, activation, password resets). This is a SendGrid API flag — `tracking_settings.click_tracking.enable: false`. Click tracking is appropriate for marketing emails; for security-critical links it's actively harmful because it breaks the URL when the tracking domain isn't fully trusted.

This is implemented in Phase 2.

---

## 3. Every invite/activation URL construction in the codebase

| Location | URL constructed | Variable used |
|---|---|---|
| crm-auth.ts:297 | `${CLIENT_URL}/accept-invite?token=…&email=…` | `CLIENT_URL` |
| crm-auth.ts:420 | `${CLIENT_URL}/reset-password?token=…&email=…` | `CLIENT_URL` |
| portal.ts:111-113 | `${base}/portal/activate?token=…` (portal customer activation) | `APP_URL` → `PORTAL_APP_URL` → `CLIENT_URL` → fallback |
| portal.ts:962 | `${APP_URL}/#/portal/messages` (message notification) | `APP_URL` (hardcoded fallback) |
| google-calendar.ts:58, 61 | OAuth redirect | `CLIENT_URL` |
| QuotesPage.tsx (frontend, hosted-quote link) | `window.location.origin + '/#/q/' + token` | client-side, no env |

**Action:** consolidate to a single helper `buildFrontendUrl(path)` so all of the above resolve from the same source.

---

## 4. Contacts save flow — where the chain breaks

**Frontend:** [apps/web/src/CustomersPage.tsx](apps/web/src/CustomersPage.tsx)

| Step | What happens | Persistence |
|---|---|---|
| User clicks "Save Customer" | Calls `setCustomers(prev => …)` | local React state |
| Inside the same callback | `localStorage.setItem('fencepro_customers', JSON.stringify(updated))` (line 1196) | **localStorage only** |
| Save flow ends | No API call | **Database is never written to** |

**The chain breaks at step 3.** The CRM web app *never* calls a backend endpoint when a customer is saved. There is no `POST /api/customers` route — only a `POST /api/sync/customers` upsert route ([sync.ts:76](apps/portal/src/server/routes/sync.ts#L76)) intended for the CRM to push customers into the portal DB so the customer-portal side can see them. The CRM frontend never invokes it for save events.

**This means every "saved" customer survives only as long as the user's browser localStorage exists.** A different browser, an incognito session, a localStorage clear, or the user switching devices all result in the customer "disappearing."

**Database connectivity is fine:** the portal backend is configured for **PostgreSQL** ([prisma/schema.prisma:5-8](apps/portal/prisma/schema.prisma#L5-L8) — `provider = "postgresql"`, `url = env("DATABASE_URL")`). Prisma migrations exist. The DB write would succeed if anything actually called it.

---

## 5. DATABASE_URL & infra

| Item | Status |
|---|---|
| Provider | PostgreSQL (Prisma) ✅ |
| Local dev URL | `postgresql://fencepro:fencepro@localhost:5432/fencepro_portal` |
| Production URL | Set in hosting platform env (not committed). Must be a managed PostgreSQL instance. |
| Schema | 70+ models including Customer, Invoice, Lead, CrmUser, CrmAccount, Document, Contract, Quote, etc. |
| Migrations | Yes — Prisma migrations exist; deployed via `prisma migrate deploy` |
| Connection pool | Default Prisma pool (uses native libpq pooling). Production should use a managed PG service (Render, Supabase, Neon) — not in-memory or SQLite. |

No SQLite `file:` prefix found. No in-memory database. **The DB layer itself is fine** — it's just under-used by the CRM frontend.

---

## 6. Where every type of data actually lives today

### In PostgreSQL (when the API is called)
- Portal customer accounts, sessions, refresh tokens
- CRM team-member users (`crmUser`), sessions, activity log
- Invoices (synced via `POST /api/sync/invoices`)
- Tickets, contracts (synced)
- Vendor records (`VendorContact`, `VendorBill`, `VendorPayment`)
- Documents metadata (with file blob in S3 or local `UPLOAD_DIR`)
- Customer-portal messages, chat, ticket comments
- Bundle / quote-bundle definitions
- API keys (hashed)

### In **localStorage** only (the surprising part)
| Store key | What it holds | Files writing to it |
|---|---|---|
| `fencepro_customers` | All customer records | CustomersPage.tsx |
| `fencepro_pipeline` | All pipeline leads + stage config | JobsPage.tsx, SalesPipelineBoard.tsx |
| `fencepro_jobs` | All job records | jobStore.ts, OperationsBoard.tsx, OperationsPage.tsx |
| `fencepro_quotes` | All quote records | QuotesPage.tsx, QuoteBuilder.tsx |
| `fencepro_files` | Customer file metadata | CustomerFilesTab.tsx |
| `fencepro_staging` | Staging board rows | StagingPage.tsx |
| `fencepro_imported_quotes`, `fencepro_pending_orders`, `fencepro_jobcosting`, `fencepro_quote_templates`, `fencepro_site_plans`, `fencepro_schedule`, `fencepro_inventory`, `fencepro_pl_entries`, `fencepro_balance_sheet`, `fencepro_cashflow_manual`, `fencepro_vendors`, `fencepro_vendor_bills`, `fencepro_vendor_payments`, `fencepro_automations`, `fencepro_email_templates`, `fencepro_settings`, `fencepro_config`, `fencepro_user`, `fencepro_company` | Various business records | App.tsx, JobsPage.tsx, JobsPipeline.tsx, QuoteBuilder.tsx, QuotesPage.tsx, SchedulePage.tsx, SitePlanTool.tsx, SitePlansPage.tsx, StagingPage.tsx, PortalQuoteSettings.tsx, QuoteDetailDrawer.tsx, PublicQuotePage.tsx, pendingOrderStore.ts, quoteTemplatesStore.ts |
| `fencepro_pipeline_*`, `fencepro_ops_*` (this session) | Board view preferences | SalesPipelineBoard.tsx, OperationsBoard.tsx — these are intentional UI prefs |

**Architectural note:** the CRM was clearly designed as a localStorage-first single-user app ("EZBiz solo edition"), with the portal backend used only for outbound integration (customer portal, syncing data customers see). There is no per-user CRM persistence in the DB. Every business record except CrmUser/CrmAccount lives only in the operator's browser.

### In S3 / local disk
- Customer-uploaded files via the portal API (controlled by `STORAGE_DRIVER` and `UPLOAD_DIR`)
- Quote PDFs, contract PDFs (generated on demand)

---

## 7. Every form save operation in the frontend (high-level)

Audit pass over each `tsx` file. The common pattern is **`localStorage.setItem` only, no API call**:

| Group | File | Persists to API? | Persists to localStorage? |
|---|---|---|---|
| Customer create/edit | CustomersPage.tsx | ❌ no | ✅ yes |
| Add note to customer | CustomersPage.tsx | ❌ no | ✅ yes |
| Upload customer file | CustomerFilesTab.tsx | ❌ no | ✅ yes (metadata only) |
| Add lead | JobsPage.tsx, SalesPipelineBoard.tsx | ❌ no | ✅ yes |
| Edit lead / move stage | JobsPage.tsx, SalesPipelineBoard.tsx | ⚠️ fires automation but no persistence write | ✅ yes |
| Create quote | QuoteBuilder.tsx | ❌ no | ✅ yes |
| Mark quote sold | signedContractFlow.ts | ✅ yes (calls `applySignedContractTransition` which creates a job and can sync to portal) | ✅ yes |
| Create job | jobStore.ts | ⚠️ optional `syncJob()` call | ✅ yes |
| Move job stage | OperationsPage / OperationsBoard | ⚠️ same | ✅ yes |
| Create invoice | (none — billing is read-only summary on Customer drawer) | ❌ no |  |
| Add P&L / Balance Sheet / Cash Flow entry | PLStatementPage.tsx, BalanceSheetPage.tsx, etc. | ❌ no | ✅ yes |
| Create vendor | VendorsPage.tsx | ❌ no | ✅ yes |
| Save settings | AdminSettingsPage.tsx | ❌ no | ✅ yes |
| Send team-member invite | AdminPage.tsx → calls `/api/crm-auth/invite` | ✅ yes | n/a |
| Login / accept-invite / refresh / logout | App.tsx → crmAuth.ts | ✅ yes (this is fully wired to the DB) | local token only |
| Send portal customer invite | CustomersPage.tsx → portalSync.ts | ✅ yes | n/a |
| Customer Portal actions (set password, send message, upload doc, accept quote) | CustomerPortalApp.tsx → portal API | ✅ yes (database-backed) | n/a |

**Summary:** auth, customer portal, team-member auth, and a few "spillover" sync calls write to the DB. **Almost everything else is browser-local.**

---

## What we're going to fix in this run

The instruction says "Everything saved in EZBiz must be stored permanently in the database and never lost." Migrating every CRM entity to API-backed persistence is a multi-week, multi-PR architectural project (it would mean rewriting CustomersPage, QuoteBuilder, JobsPage, every Settings page, every store module, etc. — and adding ~30 backend routes).

What this fix-pass delivers:

1. **Phase 2** — kill the SSL-broken invite URL bug at the SendGrid layer (per-message disable click-tracking on transactional emails). Add `buildFrontendUrl()` helper + APP_URL validator on startup. Resend any pending team-member and portal-customer invites.
2. **Phase 3** — add a real `POST/PUT/DELETE/GET /api/crm-customers` route backed by a new Prisma model + wire CustomersPage to dual-write (localStorage + API), with optimistic UI and toast errors. This makes the most-trafficked form database-backed today.
3. **Phase 4** — produce a complete inventory of every save site and document what still needs migration (so the rest can be sequenced).
4. **Phase 5** — verify the team-member invite happy path end-to-end now that the URL is fixed.
5. **Phase 6** — definitive `DATA_STORAGE_ARCHITECTURE.md` describing reality and the migration target.
6. **Phase 7** — startup env validator + `ENVIRONMENT_FIXES.md` listing exactly what to set in the host.
7. **Phase 8** — `CRITICAL_FIXES_VERIFICATION.md` with pass/fail per test.

A sweeping "every form now writes to the DB" change is **explicitly out of scope** for this single fix-pass because it exceeds what can be safely shipped without breaking the live app. It is documented as the next-step migration target.
