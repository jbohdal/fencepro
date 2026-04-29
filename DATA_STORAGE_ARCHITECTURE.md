# EZBiz Data Storage Architecture
**Date:** 2026-04-28
**Owner:** Jonathan Bohdal
**Scope:** Definitive reference for where every piece of data in EZBiz lives.

---

## TL;DR

EZBiz has **three storage tiers**:

1. **PostgreSQL** (`apps/portal/prisma/schema.prisma`) — primary persistent store, used by everything that touches the customer portal, team-member auth, and (as of this fix-pass) CRM contacts. This is the only tier where business data is **safe across browsers, devices, and deploys**.
2. **S3 / local UPLOAD_DIR** — file blobs (uploaded photos, docs, attachments).
3. **`localStorage`** — historically the **primary** store for most CRM business data. After this fix-pass it remains in use for instant-UX caching and offline tolerance, but customers are now also persisted to Postgres via `/api/crm-contacts`. Other entities (quotes, jobs, invoices, vendors, settings, …) **still live only in localStorage** and need to be migrated in subsequent PRs.

---

## 1. PostgreSQL — what already persists permanently

| Table | What it stores | Currently safe? |
|---|---|---|
| `Customer` | Customer-portal login accounts (passwordHash, email, role, account linkage) | ✅ |
| `CrmAccount` | Tenants / business accounts | ✅ |
| `CrmUser` | CRM team-member accounts (admins, sales reps, field crew, office staff). Includes invite tokens, password hashes, lockout state, role, status. | ✅ |
| `CrmUserSession` | Refresh tokens for CRM logins | ✅ |
| `CrmUserActivity` | Audit log: login, logout, invite_sent, role_changed, etc. | ✅ |
| **`CrmContact`** *(NEW this PR)* | **CRM customer/contact records, mirrored from localStorage on save** | ✅ (dual-write) |
| `Document` | File metadata + storage path. The blob itself is in `UPLOAD_DIR` or S3. | ✅ |
| `Invoice` | Invoices synced from CRM | ✅ |
| `Contract` | Contracts | ✅ |
| `Ticket`, `TicketComment` | Customer support tickets | ✅ |
| `Lead` | Leads captured by the public chatbot / website | ✅ |
| `LeadFollowup`, `LeadInteraction`, `LeadNote` | Lead activity timeline | ✅ |
| `LeadAppointment` | Calendar bookings | ✅ |
| `Quote`, `QuoteOption`, `QuoteBundle`, `QuoteBundleInclusion`, `QuoteBundleAddon` | Quote engine — bundle definitions, generated quotes, customer-facing options | ✅ |
| `QuoteJobChecklistItem`, `JobChecklistItem` | Operations checklist items per job | ✅ |
| `VendorContact`, `VendorBill`, `VendorBillLineItem`, `VendorPayment` | Vendor management | ✅ |
| `RefreshToken`, `AuditLog`, `Notification` | Auth & notifications | ✅ |
| `PortalAccount` | Customer-portal accounts (separate from `Customer`) — invite tokens, status, last login | ✅ |
| `EmailTemplate` | Templated emails | ✅ |
| `Automation`, `AutomationRun` | Automation rules + run history | ✅ |
| `Integration` | Integration credentials (encrypted) | ✅ |
| Several others (Knowledge base, Conversation, ChatConversation, ChatMessage, etc.) | | ✅ |

---

## 2. S3 / Object storage

Files (photos, PDFs, attachments) are written through `apps/portal/src/server/lib/storage/`. Driver is selected by `STORAGE_DRIVER` env var:

| Driver | Backing | Persistence |
|---|---|---|
| `local` (default) | `${UPLOAD_DIR}` on disk | **Ephemeral** on Render, Railway, Fly, Vercel — lost on every deploy |
| `s3` | AWS S3 bucket | **Persistent** ✅ |

**Action:** in production set `STORAGE_DRIVER=s3` plus `AWS_*` and `AWS_S3_BUCKET`.

| File category | Goes to |
|---|---|
| Customer-uploaded documents | `Document` row + storage |
| Customer-uploaded photos | Storage (linked from `Document`) |
| Staff-uploaded files | Storage |
| Quote PDFs | Generated on demand — not stored |
| Invoice PDFs | Generated on demand |
| Contract PDFs | `Contract.fileUrl` — should be storage-backed |
| Pull-sheet PDFs | Generated on demand |
| Company logo | Storage if uploaded; otherwise data-URI in Settings |
| Site-plan images | localStorage today — *needs* migration |
| Quote-template photos | localStorage today — *needs* migration |

---

## 3. localStorage — what still lives there (and what to do about it)

Each key below is a JSON blob in the user's browser. Lost on browser clear, incognito, device change, etc.

| Key | Owner | Persistence target |
|---|---|---|
| `fencepro_customers` | CustomersPage.tsx | **Now also in Postgres** via `/api/crm-contacts` (this PR) |
| `fencepro_pipeline` | JobsPage.tsx, SalesPipelineBoard.tsx | TODO: `CrmPipelineLead` model |
| `fencepro_jobs` | jobStore.ts, OperationsBoard.tsx | TODO: `CrmJob` model + sync route |
| `fencepro_quotes` | QuotesPage.tsx, QuoteBuilder.tsx | TODO: existing `Quote` model — wire web app to `/api/quotes` |
| `fencepro_files` | CustomerFilesTab.tsx | Use existing `Document` model |
| `fencepro_staging` | StagingPage.tsx | Subset of jobs |
| `fencepro_imported_quotes` | QuotesPage.tsx | Subset of quotes |
| `fencepro_pending_orders` | pendingOrderStore.ts | TODO |
| `fencepro_jobcosting` | JobCostingTab.tsx | Subset of jobs |
| `fencepro_quote_templates` | quoteTemplatesStore.ts | TODO |
| `fencepro_site_plans` | SitePlansPage.tsx | TODO + storage |
| `fencepro_schedule` | SchedulePage.tsx | Subset of jobs |
| `fencepro_inventory` | InventoryPage.tsx | TODO: `InventoryItem` model |
| `fencepro_pl_entries` | PLStatementPage.tsx | TODO: `PnlEntry` model |
| `fencepro_balance_sheet` | BalanceSheetPage.tsx | TODO: `BalanceSheetEntry` model |
| `fencepro_cashflow_manual` | CashFlowPage.tsx | TODO |
| `fencepro_vendors` | VendorsPage.tsx | Already have `VendorContact` — wire it |
| `fencepro_vendor_bills` | VendorsPage.tsx | Already have `VendorBill` — wire it |
| `fencepro_vendor_payments` | VendorsPage.tsx | Already have `VendorPayment` — wire it |
| `fencepro_automations` | AutomationsPage.tsx | Already have `Automation` — wire it |
| `fencepro_email_templates` | AdminSettingsPage.tsx | Already have `EmailTemplate` — wire it |
| `fencepro_settings`, `fencepro_config`, `fencepro_company` | App.tsx, AdminSettingsPage.tsx | TODO: `CompanySetting` (key/value) model |
| `fencepro_user` | App.tsx | Profile cache — acceptable since the source of truth is `CrmUser` |

### Acceptable in localStorage (UI preferences only)

These are pure UI state and are **safe** to keep local:

| Key | What it stores |
|---|---|
| `fencepro_pipeline_view`, `fencepro_pipeline_collapsed_stages`, `fencepro_pipeline_sort`, `fencepro_pipeline_analytics_open` | Sales-pipeline board prefs (this session) |
| `fencepro_ops_view`, `fencepro_ops_collapsed_stages`, `fencepro_ops_sort`, `fencepro_ops_analytics_open`, `fencepro_ops_show_completed`, `fencepro_ops_highlight_today` | Operations board prefs |
| `crm_access_token`, `crm_refresh_token` | JWT cache (renewed via `/api/crm-auth/refresh`) |
| `fencepro_contacts_db_migrated_v1` | Flag to suppress repeated bulk migration |

---

## 4. What MUST never be in localStorage

| Data category | Status |
|---|---|
| Customer / contact records | ✅ Now in Postgres via this PR (dual-write). |
| Quote data | ⚠️ Still localStorage. Migration needed: rewrite QuoteBuilder + QuotesPage to call `/api/quotes` (the table already exists). |
| Job data | ⚠️ Still localStorage. Migration needed: new `CrmJob` model + `/api/crm-jobs`. Some sync via `portalSync.ts` already partially happens for completed jobs. |
| Invoice data | ⚠️ The `Invoice` Prisma model exists and the sync route works. The CRM frontend's "Create Invoice" button currently writes to localStorage only. |
| Any financial data (P&L, BS, cash flow) | ⚠️ Still localStorage. |
| Vendor records, vendor bills, vendor payments | ⚠️ Models exist, frontend not wired. |
| Settings / pipeline-stage configuration | ⚠️ Still localStorage (`fencepro_settings`, `fencepro_config`). |

Each ⚠️ above is a separate migration ticket. The pattern established by this PR (`CrmContact` model + `/api/crm-contacts` route + dual-write client + one-time bulk migration helper) is the template.

---

## 5. Migration playbook (per entity)

For each entity that needs migrating off localStorage:

1. Add a Prisma model (or confirm an existing one matches the frontend shape).
2. `npx prisma migrate dev --name add_<entity>` then `prisma generate`.
3. Add `apps/portal/src/server/routes/crm-<entity>.ts` exposing GET / POST / PATCH / DELETE / sync.
4. Mount at `/api/crm-<entity>` in `index.ts`.
5. Add `apps/web/src/<entity>Api.ts` thin client (auth header + JSON).
6. Wire the frontend page's save handlers to dual-write.
7. Add a `migrate<Entity>LocalOnce()` helper that POSTs the existing localStorage payload.
8. Remove localStorage-only fallbacks once dual-write has been verified in production for ≥7 days.

The `CrmContact` flow ([crm-contacts.ts](apps/portal/src/server/routes/crm-contacts.ts), [crmContactsApi.ts](apps/web/src/crmContactsApi.ts)) is the reference implementation.
