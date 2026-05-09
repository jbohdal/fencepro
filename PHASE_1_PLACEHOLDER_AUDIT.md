# Phase 1 Placeholder Audit

**Date:** 2026-05-08
**Phase:** 1 (Customers)
**Scope:** every interactive element on every page in the customers surface area
**Status legend:**
- **WORKS** — element does what its label says, fully API backed where canonical
- **BROKEN** — element exists but does not work as labeled (genuine bug in scope)
- **FAKE** — element is a placeholder (sample data, dead handler, lying toast)
- **DEPENDS_ON_LATER_PHASE [N]** — element exists but the data behind it is not yet API backed; will be migrated in Phase N. Logged in `CROSS_PHASE_PLACEHOLDERS.md` and either left honest, hidden, or banner labeled per Jonathan's call.

**Resolution status (2026-05-08, after fix pass):**
- All BROKEN items resolved (Notes CRUD migrated to DB, Cmd+K customer hit pre-selects).
- All DEPENDS_ON_LATER_PHASE items now show honest disclosure banners on the customer profile (Quotes / Jobs / Costing / Billing / Pull Sheets tabs) per Jonathan's chosen Option A. Each entry is logged in `CROSS_PHASE_PLACEHOLDERS.md`.
- No FAKE items remain.

---

## A. Customers list page (left rail)

File: [apps/web/src/CustomersPage.tsx](apps/web/src/CustomersPage.tsx)

| # | Element | Status | Notes |
|---|---|---|---|
| A1 | "+ New" button (top of left rail) | WORKS | Opens CustomerForm in new mode |
| A2 | Search input | WORKS | Filters in memory cache by name / phone / email / serviceAddress |
| A3 | "Import CSV" file picker | WORKS | Parses CSV, calls `bulkImportCustomers` → API; honest toast on completion |
| A4 | Customer row click | WORKS | Selects + switches to view mode |
| A5 | Row level "×" delete button | WORKS | Confirm dialog + `storeDeleteCustomer` → API; visible at all times after Phase 1 fix |
| A6 | Footer "N customers" count | WORKS | Reflects current cache state, updates on event |
| A7 | Empty state (no customers found) | WORKS | Honest message |

---

## B. Customer profile pane (right side)

File: [apps/web/src/CustomersPage.tsx](apps/web/src/CustomersPage.tsx) `CustomerDetail` (line 750)

### B.1 Header

| # | Element | Status | Notes |
|---|---|---|---|
| B1 | "+ New Quote" button | DEPENDS_ON_LATER_PHASE [2] | Opens QuoteBuilder; quote save still goes to localStorage `fencepro_quotes` |
| B2 | "Edit" button | WORKS | Opens CustomerForm in edit mode, save flows through `upsertCustomer` |
| B3 | "Delete" button (red, added in Phase 1 fix) | WORKS | Confirm + soft archive via API |
| B4 | "Signed / Sold" badge | WORKS | Derived from quotes (read only) |
| B5 | "Quote Sent" badge | WORKS | Derived from quotes (read only) |
| B6 | KPI tiles: Total Revenue / Quotes / Jobs / Customer Since | DEPENDS_ON_LATER_PHASE [2,3] | Derived from quotes + jobs which still live in localStorage |

### B.2 Portal Access Section

File: [CustomersPage.tsx:1483](apps/web/src/CustomersPage.tsx#L1483)

| # | Element | Status | Notes |
|---|---|---|---|
| B7 | "Send Portal Invite" button | WORKS | Calls server, falls back to mailto if email service is offline (honest toast) |
| B8 | "Resend Invite" button | WORKS | Server backed; rate limit surfaces a warning toast |
| B9 | "Copy Activation Link" button | WORKS | Re-issues invite + copies to clipboard |
| B10 | Status display (Activated / Invited / etc.) | WORKS | Reads `getPortalAccessStatus` which polls server |

### B.3 Tabs (10 total)

Tab nav: **overview, quotes, jobs, billing, costing, notes, pullsheets, files, photos, messages**

#### Overview

| # | Element | Status | Notes |
|---|---|---|---|
| B11 | Contact Details rows (read only) | WORKS | Reads from CrmContact via cache |
| B12 | Notes (read only excerpt of customer.notes field) | WORKS | Same as above. Distinct from the Notes tab below |

#### Quotes

| # | Element | Status | Notes |
|---|---|---|---|
| B13 | "Imported Quote History" table | DEPENDS_ON_LATER_PHASE [2] | Reads `localStorage.fencepro_imported_quotes` |
| B14 | "Quotes from EZBiz" table | DEPENDS_ON_LATER_PHASE [2] | Reads `localStorage.fencepro_quotes` |
| B15 | Row click → opens QuoteDetailDrawer | DEPENDS_ON_LATER_PHASE [2] | Drawer reads / writes localStorage |
| B16 | Empty state "Create first quote" link | DEPENDS_ON_LATER_PHASE [2] | Calls onNewQuote → QuoteBuilder (Phase 2) |

#### Jobs

| # | Element | Status | Notes |
|---|---|---|---|
| B17 | Jobs table | DEPENDS_ON_LATER_PHASE [3] | Reads `localStorage.fencepro_jobs` |
| B18 | Empty state message | WORKS | Static, accurate explanation |

#### Costing

File: [CustomersPage.tsx:677](apps/web/src/CustomersPage.tsx#L677) `CustomerJobCostingTab`

| # | Element | Status | Notes |
|---|---|---|---|
| B19 | Job costing rows + summary tiles | DEPENDS_ON_LATER_PHASE [3] | Reads `localStorage.fencepro_jobcosting` |
| B20 | Empty state | WORKS | Static, accurate explanation |

#### Billing

File: [CustomersPage.tsx:308](apps/web/src/CustomersPage.tsx#L308) `CustomerBillingTab`

| # | Element | Status | Notes |
|---|---|---|---|
| B21 | Sub-nav: overview / invoices / payments | WORKS (UI), data DEPENDS_ON_LATER_PHASE [9] | Tab switch works; underlying data is `billingStore` (localStorage) |
| B22 | Aging summary tiles | DEPENDS_ON_LATER_PHASE [9] | Computed from localStorage invoices |
| B23 | "+ Create Invoice" button | DEPENDS_ON_LATER_PHASE [9] | Opens CreateInvoiceModal; modal save writes to localStorage. **Will appear to save but not sync to teammates until Phase 9.** |
| B24 | Invoice row "Record Payment" button | DEPENDS_ON_LATER_PHASE [9] | Opens RecordPaymentModal; modal save writes to localStorage |
| B25 | Invoice list rendering | DEPENDS_ON_LATER_PHASE [9] | Reads `getInvoicesForCustomer` (localStorage) |
| B26 | Payment list rendering | DEPENDS_ON_LATER_PHASE [9] | Reads `getPaymentsForCustomer` (localStorage) |

#### CreateInvoiceModal

| # | Element | Status | Notes |
|---|---|---|---|
| B27 | "Create Invoice" save button | DEPENDS_ON_LATER_PHASE [9] | Writes to localStorage only; toast says "Created" |
| B28 | "+ Add" line item | WORKS | Local state only |
| B29 | "×" remove line item | WORKS | Local state only |
| B30 | Cancel button | WORKS | Closes modal |

#### RecordPaymentModal

| # | Element | Status | Notes |
|---|---|---|---|
| B31 | "Record Payment" save button | DEPENDS_ON_LATER_PHASE [9] | Writes to localStorage only |
| B32 | Cancel button | WORKS | Closes modal |

#### Notes

File: [CustomersPage.tsx:538](apps/web/src/CustomersPage.tsx#L538) `CustomerNotesTab`

| # | Element | Status | Notes |
|---|---|---|---|
| B33 | "Add Note" button | **FIXED → WORKS** | Now `createContactNote` → `/api/crm-contacts/:id/notes`; tenant scoped by accountId; verified with curl |
| B34 | Pin / Unpin button | **FIXED → WORKS** | `updateContactNote` PATCH with `isPinned` toggle |
| B35 | Edit note button | **FIXED → WORKS** | `updateContactNote` PATCH with new body |
| B36 | Delete note button | **FIXED → WORKS** | `deleteContactNote` soft delete via DELETE; toasts on failure |
| B37 | Search notes input | **FIXED → WORKS** | Filters in memory; underlying list is now DB backed |
| B38 | Note list rendering | **FIXED → WORKS** | `listContactNotes` GET; loading state honest |

#### Pull Sheets

File: [CustomersPage.tsx:621](apps/web/src/CustomersPage.tsx#L621) `CustomerPullSheetsTab`

| # | Element | Status | Notes |
|---|---|---|---|
| B39 | Pull sheet list rendering | DEPENDS_ON_LATER_PHASE [2] | Reads `getPullSheetsForCustomer` (localStorage, derived from quotes) |
| B40 | Row click expand viewer | DEPENDS_ON_LATER_PHASE [2] | Same. |
| B41 | Close viewer button | WORKS | UI only |

#### Photos

File: [apps/web/src/CustomerPhotosTab.tsx](apps/web/src/CustomerPhotosTab.tsx)

| # | Element | Status | Notes |
|---|---|---|---|
| B42 | "+ Upload Photos" button | WORKS | API: `uploadStaffPhotoForCustomer` |
| B43 | Drag/drop upload | WORKS | Same |
| B44 | Photo card menu: View Full Size | WORKS | Lightbox modal |
| B45 | Photo card menu: Download | WORKS | Anchor click |
| B46 | Photo card menu: Delete | WORKS | API: `deletePortalPhoto` + confirm |
| B47 | Lightbox prev / next / close | WORKS | UI only |
| B48 | Lightbox keyboard shortcuts (Esc, ←/→) | WORKS | Functional |
| B49 | "All / CompanyCam" sub-tab toggle | WORKS (UI), CompanyCam DEPENDS_ON_LATER_PHASE [8 - Integrations] | Sub-tab only renders when CompanyCam is "linked" via localStorage flag; CompanyCam content shows honest "Live photos will appear once integration is fully wired" message |

#### Files

File: [apps/web/src/CustomerFilesTab.tsx](apps/web/src/CustomerFilesTab.tsx)

| # | Element | Status | Notes |
|---|---|---|---|
| B50 | "+ Upload File" button | WORKS | API: `uploadStaffDocumentForCustomer` |
| B51 | File row click → open in new tab | WORKS | Server URL |
| B52 | View / Download / Delete row buttons | WORKS | All API backed |
| B53 | Drop zone label (empty state) | WORKS | File picker triggers same upload |
| B54 | "Site Plans & Local Files" legacy section | DEPENDS_ON_LATER_PHASE [other] | Site plan workflow still localStorage backed; legacy section is a deliberate bridge until that phase migrates |

#### Messages

File: [apps/web/src/CustomerMessagesTab.tsx](apps/web/src/CustomerMessagesTab.tsx)

| # | Element | Status | Notes |
|---|---|---|---|
| B55 | Send message form | WORKS | API: `staffReplyToCustomer` |
| B56 | Enter to send / Shift+Enter newline | WORKS | UI behavior |
| B57 | Polling refresh every 15s | WORKS | API |
| B58 | Inbox unread badge dispatch | WORKS | Event fired |

---

## C. Customer form (new / edit)

File: [CustomersPage.tsx:155](apps/web/src/CustomersPage.tsx#L155) `CustomerForm`

| # | Element | Status | Notes |
|---|---|---|---|
| C1 | First / Last / Phone / Email inputs | WORKS | Local state |
| C2 | Service Address input | WORKS | Plain text input (Google autocomplete dropped earlier per d3ba664) |
| C3 | Billing Different checkbox | WORKS | Toggles billing address field |
| C4 | Lead Source pills (toggle) | WORKS | Local state |
| C5 | Tags pills (toggle) | WORKS | Local state |
| C6 | Sales Rep input | WORKS | Local state |
| C7 | First Appointment Date picker | WORKS | Local state |
| C8 | Notes textarea | WORKS | Local state |
| C9 | Cancel button | WORKS | Returns to view mode |
| C10 | Save Customer button | WORKS | Routes through `upsertCustomer` → API + cache |
| C11 | Disabled state when first / last name empty | WORKS | Honest disable |

---

## D. Modals opened from customer pages

### D.1 FileViewerModal (opened from Files tab legacy section)

File: [apps/web/src/FileViewerModal.tsx](apps/web/src/FileViewerModal.tsx)

| # | Element | Status | Notes |
|---|---|---|---|
| D1 | Close button | WORKS | Closes modal |
| D2 | Prev / Next image navigation | WORKS | Local state |
| D3 | Download button | WORKS | Anchor click |
| D4 | Delete button | DEPENDS_ON_LATER_PHASE [other] | Calls onDelete which writes localStorage `fencepro_files` (legacy site plan side) |

### D.2 QuoteDetailDrawer (opened from Quotes tab)

File: [apps/web/src/QuoteDetailDrawer.tsx](apps/web/src/QuoteDetailDrawer.tsx)

| # | Element | Status | Notes |
|---|---|---|---|
| D5 | Every interactive element on the drawer | DEPENDS_ON_LATER_PHASE [2] | Drawer reads / writes `localStorage.fencepro_quotes`; full audit happens in Phase 2 |

---

## E. Customer affordances elsewhere in the app

### E.1 App.tsx — Global Cmd+K search

File: [apps/web/src/App.tsx](apps/web/src/App.tsx)

| # | Element | Status | Notes |
|---|---|---|---|
| E1 | "Customers" search hits in Cmd+K | WORKS | Reads `getCustomers()` from cache after Phase 1 refactor |
| E2 | Click on a customer hit → navigates to Customers | **FIXED → WORKS** | Now dispatches `fencepro:select-customer` event which CustomersPage picks up and selects the row |

---

## F. Items I deliberately did NOT audit (out of Phase 1 scope)

- The Sales Pipeline / Operations Board / Schedule / Inventory / etc. pages each have their own customer-related UX (e.g. "Add lead from customer"). Those are owned by their respective phases (3, 4, 6).
- The Customer Portal (the customer-facing app at `apps/portal/src/client`) has its own audit when the portal phase is touched.
- AdminSettingsPage and other settings surfaces — Phase 9.

---

## Summary by status

- **WORKS:** ~46 elements
- **BROKEN (in Phase 1 scope, must fix before Phase 1 done):**
  - **Notes tab — entire CRUD (B33-B38).** Notes attach to a customer and are spiritually part of Phase 1, but back to localStorage. Migrate to a `CrmContactNote` model + API, or to a JSONB `notes` column on `CrmContact`, before declaring Phase 1 done.
  - **E2 — Cmd+K customer hit does not pre-select the row** when navigating to Customers page. Action text implies it should.
- **FAKE:** none after the SAMPLE_CUSTOMERS removal earlier.
- **DEPENDS_ON_LATER_PHASE:**
  - Phase 2 (Quotes): B1, B6, B13–B16, B39–B41, D5
  - Phase 3 (Jobs): B6, B17, B19
  - Phase 8 (Integrations): B49 CompanyCam sub-tab
  - Phase 9 (Billing): B21–B32
  - Other localStorage workflows still in transition: B54, D4

These will be logged in `CROSS_PHASE_PLACEHOLDERS.md`.

---

## Recommended Phase 1 fix scope (resolved)

1. **Notes tab** — DONE. New `CrmContactNote` model + visibility enum + 5 routes (`GET /:id/notes`, `POST /:id/notes`, `PATCH /:id/notes/:noteId`, `DELETE /:id/notes/:noteId`, `POST /notes/sync` for one shot legacy migration). `CustomerNotesTab` rewritten to call the API. `migrateLocalNotesOnce` runs once after `initCustomers` to push the legacy `localStorage.fencepro_customer_notes` into the DB.
2. **E2 (Cmd+K customer hit)** — DONE. Click handler now dispatches `fencepro:select-customer`.

Items DEPENDS_ON_LATER_PHASE were left functional locally with honest disclosure banners on the affected tabs (Quotes, Jobs, Costing, Billing, Pull Sheets). The CompanyCam sub tab message was already honest. The site plan / file legacy section is left as a documented bridge.

Every placeholder banner and the legacy bridge are indexed in `CROSS_PHASE_PLACEHOLDERS.md` so future phases know exactly what to remove when their migration lands.
