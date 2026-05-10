# Mobile Responsive Audit

**Date:** 2026-05-10
**Goal:** every page, modal, table, form usable on devices down to 375px wide with no horizontal scroll and no manual resize.

## Existing infrastructure (already in place)

`apps/web/src/index.css` defines a Mobile Responsive Layer with helper classes scoped to `max-width: 1023px`:

- `.sidebar-desktop` — hidden on <1024px
- `.mobile-nav-drawer` + `.mobile-nav-backdrop` — slide-in side drawer
- `.mobile-header` — top bar shown only on <1024px (hamburger lives here)
- `.mobile-only` — hide on >=1024px
- `.modal-responsive` — full-screen modal sizing on <1024px
- `.slideover-responsive` — full-width slideover on <1024px
- `.table-responsive-cards` — converts table rows to cards on <1024px (uses `data-label` attrs on `<td>`)
- `.grid-mobile-1` / `.grid-mobile-2` / `.grid-tablet-2` / `.grid-tablet-3`
- `.touch-target` + global rule: `button, a, select` get `min-height: 44px` on <1024px; `input, textarea, select` get `font-size: 16px` to prevent iOS zoom

`App.tsx` already renders the mobile nav drawer + hamburger. The desktop sidebar is correctly tagged `sidebar-desktop`. So global navigation works.

## What is broken / missing

| Area | Issue | Severity |
|---|---|---|
| `index.html` viewport meta | Has `maximum-scale=1.0, user-scalable=no` — kills pinch-to-zoom which the spec explicitly says to remove | High |
| `CustomersPage` rail | Hard `w-72` master-detail layout breaks at <1024px (288px rail + detail = horizontal overflow) | High |
| `QuotesPage` | Same master-detail pattern with desktop-only widths | High |
| `OperationsBoard` kanban | Already has `overflow-x-auto` — works but is awkward on phones; no list-on-mobile fallback | Medium |
| Modals (`CustomerForm`, `CreateInvoiceModal`, `RecordPaymentModal`, `FileViewerModal`, `BulkImportModal`, etc.) | Use fixed `max-w-[NNNpx]` widths; none use `modal-responsive` class | High |
| `QuoteDetailDrawer` | Side drawer with fixed width; doesn't use `slideover-responsive` | High |
| Tables (Customers list, Quotes list, Invoices list, Vendors list, Inventory, Pending Orders, Bills, Payments) | None use `table-responsive-cards`; some have `overflow-x-auto` workaround | High |
| `BudgetPage`, `PLStatementPage`, `BalanceSheetPage`, `ReportsPage` | Wide grids of numbers with no responsive scaling | Medium |
| `AdminSettingsPage` + sub settings | Two column form layouts assume desktop | Medium |
| `BundlesPage` | Three-tier Good/Better/Best side by side | Medium |
| `MapQuoteBuilder`, `SitePlanTool` | Map canvas + drawing tools; expect mouse and a wide viewport | Lower priority — these are inherently desktop tools |
| Public pages (`PublicQuotePage`, `PublicPresentationPage`) | Already used on phones by customers; need most attention | High |

## Fix order

1. **Viewport meta** — strip the zoom lock.
2. **Master-detail pages** (Customers, Quotes) — stack vertically on mobile, show one pane at a time with back button.
3. **Modals + drawers** — add `modal-responsive` / `slideover-responsive` classes.
4. **Critical tables** — add `table-responsive-cards` + `data-label` attrs to the Customers, Quotes, Invoices, Vendors, Bills, Inventory tables.
5. **Public pages** — give the customer-facing quote view extra attention (they always view on phones).
6. **Kanban boards** — keep horizontal scroll but tighten column widths on mobile so multiple columns peek.
7. **Admin + finance pages** — add `flex-col lg:flex-row` to two-column forms; reduce padding on mobile.
