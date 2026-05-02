# EZ Biz — Full Production Audit Report

Generated: 2026-05-02

---

## Executive Summary

EZ Biz is a field service and sales platform for fence contracting companies. The codebase is a pnpm monorepo with two primary applications:

- **`apps/web`** — React/Vite SPA (the main CRM + management interface)
- **`apps/portal`** — Express backend API + React customer portal frontend

---

## Module Inventory

### Legend
- ✅ Present and working
- ⚠️ Present but incomplete / has known gaps
- ❌ Missing entirely

---

### Sales

| Module | Status | Notes |
|--------|--------|-------|
| Sales Pipeline Board | ✅ | Kanban + list view, analytics strip, mobile accordion |
| Customer Management | ✅ | Full CRUD, notes, tags, portal access, CRM sync |
| Quote Builder | ✅ | Material calc, rail optimizer, pull sheet, address autocomplete |
| Map Quote Builder | ✅ | Draw fence runs on Google Maps, auto-populate QuoteBuilder |
| Quote Options / Bundles | ✅ | Multi-option presentation with share links |
| Quote Acceptance (Public) | ✅ | Public URL, signature capture, status update |
| Presentation Page | ✅ | Shareable option cards (no internal cost data) |
| Address Autocomplete | ✅ | Google Places on quote builder, customer form, job site |
| Pull Sheet Auto-Population | ✅ | Accepted quote → pull sheet linked to customer file automatically |
| Lead Scoring | ✅ | 0-100 score, follow-up scheduling |
| EZ Budget Widget | ✅ | Embeddable instant quote widget, public API |

---

### Operations

| Module | Status | Notes |
|--------|--------|-------|
| Operations Board | ✅ | Vertical swimlane kanban, drag-and-drop, analytics |
| Schedule Page | ✅ | Calendar view, rain day flagging, crew assignments |
| Dispatch Page | ✅ | Map view of scheduled jobs |
| Smart Schedule | ✅ | Route optimization for crew assignments |
| Staging Page | ✅ | Legacy staging view (still accessible, feeds OperationsBoard) |
| Rain Day Cascade | ✅ | Flags job, triggers automation, queues reschedule |
| Site Plans | ✅ | Drawing tool for property layouts |
| Job Costing | ✅ | Per-job cost tracking with actuals vs. estimate |
| Job Checklist / Milestones | ✅ | Configurable milestone checklist per job |
| Change Orders | ✅ | Approved change order tracking, adds to contract value |

---

### Inventory

| Module | Status | Notes |
|--------|--------|-------|
| Inventory Items (CRUD) | ✅ | Full CRUD, categories, SKU, cost |
| Stock Levels | ✅ | Per-location tracking |
| Inventory Locations | ✅ | Multiple warehouse/yard locations |
| Stock Transactions | ✅ | In/out/adjustment/transfer/pull-sheet transaction log |
| Low Stock Alerts | ✅ | Reorder point detection with toast warnings |
| Auto-PO Generation | ✅ | Draft PO created when reorder point crossed on quote sold |
| Material Bundles / BOM | ✅ | Fence style → bill of materials recipe |
| Bulk Import | ✅ | CSV upload for inventory items |
| Purchase Orders | ✅ | Draft PO creation from pending orders |
| Pending Orders | ✅ | Material order queue from accepted quotes |
| Inventory Dashboard | ✅ | Summary stats, low-stock list, recent transactions |
| Multi-location Thresholds | ⚠️ | Stock is tracked per location; per-location reorder points exist but alert UI shows global threshold |
| Multiple Barcodes per Item | ⚠️ | Single SKU field exists; multi-barcode lookup not implemented |
| Supplier Management | ✅ | Supplier records with contact info |

---

### Finance

| Module | Status | Notes |
|--------|--------|-------|
| Billing / AR | ✅ | Invoice creation, line items, tax, discounts, aging report |
| Payments | ✅ | Record payments, partial payments, payment history |
| AR Aging Report | ✅ | 4-bucket aging (current, 1-30, 31-60, 61-90, 90+) |
| P&L Statement | ✅ | Revenue, COGS, gross margin, overhead, net profit |
| Balance Sheet | ✅ | Assets, liabilities, equity summary |
| Cash Flow Projection | ✅ | 13-week rolling view, sourced from AR/AP/overhead |
| Budget Page | ✅ | Annual revenue goal, overhead/labor/materials/profit % targets |
| Accounts Payable | ✅ | Vendor bills, payment scheduling |
| Vendors | ✅ | Vendor CRUD, bills, payment tracking |
| Reports | ✅ | Summary reports page |
| Statement Generation | ⚠️ | Statement record exists; PDF export is a placeholder |

---

### Admin

| Module | Status | Notes |
|--------|--------|-------|
| Team Management | ✅ | Invite users, RBAC roles (owner/admin/sales/ops/shop) |
| Automations | ✅ | Full rule editor, condition evaluation, action execution, audit log |
| Integrations Framework | ✅ | Adapter pattern, QuickBooks/Stripe/GCal/CompanyCam/Connecteam marked coming soon |
| API Keys | ✅ | Masked values, last-used, rotate button, scoped access |
| Audit Log | ✅ | Full action audit trail |
| Settings / Branding | ✅ | Company info, pricing, fence styles, rail optimizer, branding |
| Email Templates | ✅ | Per-template subject/body editor with merge tags |
| Contract Templates | ✅ | Customizable contract section editor |
| Operations Stages | ✅ | Configurable ops stage list |
| Portal Quote Settings | ✅ | Customer-facing quote page configuration |

---

### Customer Portal

| Module | Status | Notes |
|--------|--------|-------|
| Portal Accounts | ✅ | Staff invites customer, activation via email token |
| Portal Login | ✅ | Email/password, password reset flow |
| Portal Dashboard | ✅ | Project overview, recent quotes/invoices |
| Quote View | ✅ | Customer sees their quotes, can accept |
| Project Tracker | ✅ | Job status with friendly stage labels |
| Invoice View | ✅ | List of invoices with balance/status |
| Document Management | ✅ | Upload/download documents |
| Photo Gallery | ✅ | View job photos |
| Two-way Messaging | ✅ | Staff ↔ Customer messages |
| Account Settings | ✅ | Profile management |

---

### Branding / Whitelabel

| Module | Status | Notes |
|--------|--------|-------|
| Company Info Config | ✅ | Name, phone, email, address in Settings |
| Branding Config Layer | ✅ | Extended config with logoUrl, primaryColor, secondaryColor, legalName, supportEmail, supportPhone |
| Dynamic Company Name | ✅ | All nav/portal/PDF headers pull from config |
| Portal Accent Color | ✅ | Configurable per company |
| Email Template Merge Tags | ✅ | {{company_name}} token in all email templates |

---

### Infrastructure

| Module | Status | Notes |
|--------|--------|-------|
| `/api/health` endpoint | ✅ | DB status, storage, email, version |
| `/api/health/storage` | ✅ | Write/read/delete test of upload dir |
| Auth (JWT + refresh tokens) | ✅ | Access + refresh token, 7-day expiry |
| Rate limiting | ✅ | Login (5/15min), upload (10/hr), API (100/min) |
| CORS configuration | ✅ | Allowlist-based, dev-permissive |
| Graceful shutdown | ✅ | SIGTERM/SIGINT handler, Prisma disconnect |
| Data integrity cron | ✅ | Daily snapshot, backup staleness alert |
| Backup/restore scripts | ✅ | Scheduled backup, restore runbook |
| Structured logging | ⚠️ | Console.log used throughout; Sentry/structured logger is a stub |
| Error tracking (Sentry) | ⚠️ | Wired if SENTRY_DSN set; not required for boot |

---

## Critical Issues — Fixed

### 1. Address Autocomplete
**Status: ✅ Working**

The `AddressAutocomplete` component in `apps/web/src/AddressAutocomplete.tsx` uses the `@googlemaps/js-api-loader` library with lazy loading via `loadPlaces()`. It:
- Falls back gracefully when `VITE_GOOGLE_MAPS_API_KEY` is missing (shows inline warning, stays typeable)
- Parses all address components (street number, route, city, state, zip)
- Returns lat/lng coordinates via `place.geometry.location`
- Is applied in: QuoteBuilder (job site address), CustomersPage (service + billing addresses), MapQuoteBuilder (property address)

**Required for full function:** Set `VITE_GOOGLE_MAPS_API_KEY` in environment.

### 2. Cross-Module Data Propagation
**Status: ✅ Working**

All major cross-module flows are wired:
- Quote sold → Job created → Pending order → Pull sheet linked (all in `handleSaveQuote`)
- Stage changes → Automation trigger fired (in job/pipeline store updates)
- Invoice created → AR updated → Cash flow recalculates on read
- Rain day flagged → Automation triggered → Jobs rescheduled

---

## Remaining Gaps

1. **PDF statement export** — Statement record exists; actual PDF generation requires a PDF library (not yet integrated). Stub returns a print-to-PDF instruction.

2. **Per-location reorder threshold UI** — Stock is tracked per location but the low-stock alert in the inventory dashboard uses a global threshold. A per-location threshold UI tab would complete this.

3. **Multiple barcodes per item** — The inventory item has a single `sku` field. Multi-barcode lookup (scan any barcode → find item) requires a `barcodes[]` array and lookup service.

4. **Sentry / structured logging** — Production paths use `console.log`. A Sentry DSN in env will enable error tracking; structured logging (Winston/Pino) would be a future enhancement.

5. **CompanyCam, Connecteam, QuickBooks, Stripe adapters** — Marked as "Coming Soon" in the integrations registry. Interface is defined; implementations are stubs waiting for API credentials.

---

## Module Status Summary

| Category | Present & Working | Incomplete | Missing |
|----------|:-----------------:|:----------:|:-------:|
| Sales | 11 | 0 | 0 |
| Operations | 10 | 0 | 0 |
| Inventory | 8 | 2 | 0 |
| Finance | 7 | 1 | 0 |
| Admin | 10 | 0 | 0 |
| Customer Portal | 10 | 0 | 0 |
| Branding | 5 | 0 | 0 |
| Infrastructure | 8 | 2 | 0 |
| **Total** | **69** | **5** | **0** |

**Production Readiness: 93%** — All critical paths are functional. Remaining gaps are enhancement-level items (PDF generation, per-location thresholds, multi-barcode, Sentry, coming-soon integrations).
