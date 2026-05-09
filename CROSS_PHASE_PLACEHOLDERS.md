# Cross Phase Placeholders

**Started:** 2026-05-08 (during Phase 1 close out)
**Purpose:** central index of UI elements that exist today but depend on data layers that will be migrated in later phases. Each entry must be revisited when the named phase lands.

The standing rule (per `feedback_no_placeholders.md`): a UI element either works as its label suggests, is hidden, or shows an honest "Available after Phase X" message. Items in this file ship with honest disclosure banners that say the data is migrating in the named phase and saves stay local until then. When the phase lands, the banner comes down and the entry is removed from this file.

---

## How to use this file

1. When you start a phase listed below, search the file for that phase number.
2. For each entry: implement the migration, remove the disclosure banner, verify the element works as labeled, then delete the entry from this file.
3. The phase is not done until every entry under its number is closed out.

---

## Phase 2 — Quotes + Quote Builder

**RESOLVED 2026-05-09 in commits a17f3a1 + 11bc728.** All entries below are
historical; banners removed, data flows through /api/saved-quotes. The
remaining open item is `localStorage.fencepro_imported_quotes` which is
still localStorage backed and will be migrated alongside a future bulk-CSV
ImportedQuote effort.

---

## Phase 3 — Jobs + Operations Board

**RESOLVED 2026-05-09.** SavedJob model + /api/saved-jobs CRUD shipped;
jobStore.ts is API backed; banners on Jobs and Costing tabs removed.
`localStorage.fencepro_jobcosting` remains the home for actual-cost entries
until a Job Costing API ships (sub-phase under Phase 9 finance work).

---

## Phase 8 — Integrations

| File | Element | Banner location | Action when Phase 8 lands |
|---|---|---|---|
| [apps/web/src/CustomerPhotosTab.tsx](apps/web/src/CustomerPhotosTab.tsx) | CompanyCam sub tab (only visible when `localStorage.fencepro_integrations.companycam.connected`) | Honest message inside the sub tab: "Live photos from CompanyCam will appear here once the integration is fully wired on the portal backend." | Move CompanyCam linkage off `localStorage.fencepro_integrations` and onto the existing `Integration` table; wire sub tab to fetch real photos from CompanyCam API |

---

## Phase 9 — Settings, P&L, Balance Sheet, Automations, Email Templates, Billing

| File | Element | Banner location | Action when Phase 9 lands |
|---|---|---|---|
| [apps/web/src/CustomersPage.tsx](apps/web/src/CustomersPage.tsx) | Billing tab (`CustomerBillingTab`) — overview / invoices / payments sub nav, aging summary tiles, invoice list, payment list | Banner at top of `CustomerBillingTab` | Remove banner; replace `getInvoicesForCustomer / getPaymentsForCustomer / getBillingSummary` with API calls into the existing `Invoice` Prisma model (extend with line items + payments tables) |
| [apps/web/src/CustomersPage.tsx](apps/web/src/CustomersPage.tsx) | "+ Create Invoice" button + `CreateInvoiceModal` | Same banner | Modal save calls API `/api/invoices` |
| [apps/web/src/CustomersPage.tsx](apps/web/src/CustomersPage.tsx) | "Record Payment" button + `RecordPaymentModal` | Same banner | Modal save calls API `/api/payments` (or `/api/invoices/:id/payments`) |

---

## Other (no fixed phase number)

| File | Element | Banner location | Action |
|---|---|---|---|
| [apps/web/src/CustomerFilesTab.tsx](apps/web/src/CustomerFilesTab.tsx) | "Site Plans & Local Files" legacy section | None — labeled "Site Plans" honestly; site plan workflow is its own future phase | When site plans get a phase, migrate `localStorage.fencepro_files` (legacy) and `localStorage.fencepro_site_plans` to API + drop the legacy section |
| [apps/web/src/FileViewerModal.tsx](apps/web/src/FileViewerModal.tsx) | Delete button on legacy files (writes `localStorage.fencepro_files`) | Inherits banner from the legacy section above | Same migration |
