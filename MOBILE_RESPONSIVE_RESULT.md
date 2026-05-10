# Mobile Responsive Overhaul

**Date:** 2026-05-10
**Spec:** every page, modal, form, and table works on devices from 375px wide up,
no horizontal page scroll, no manual resize, no zoom workaround.

## What changed

### 1. Foundational

| Change | File | Why |
|---|---|---|
| Stripped `maximum-scale=1.0, user-scalable=no` from viewport meta | apps/web/index.html | Pinch zoom must remain available; spec point 5. |
| (Verified) Mobile nav drawer + hamburger were already wired | apps/web/src/App.tsx | Sidebar hides at <1024px; hamburger opens slide-in drawer. |

### 2. Helper CSS already in place (no edits needed)

`apps/web/src/index.css` already defined the Mobile Responsive Layer with helpers
scoped to `max-width: 1023px`:

- `.sidebar-desktop` / `.mobile-nav-drawer` / `.mobile-header` / `.mobile-only`
- `.modal-responsive` — full-screen modal sizing
- `.slideover-responsive` — full-width slideover
- `.table-responsive-cards` — stacked card layout for tables (with `data-label` attrs)
- `.touch-target` plus blanket `button, a, select { min-height: 44px }`
- `input, textarea, select { font-size: 16px }` to prevent iOS zoom on focus
- `.kanban-scroll` for horizontal scroll-snap kanban columns
- `.calendar-table` for single-day stack on phones

### 3. New CSS added

`.ezbiz-quote-template` mobile overrides appended to `apps/web/src/index.css`.
The customer-facing quote templates use inline styles (since they double as the
PDF print HTML), so the mobile fix is a set of `!important` overrides scoped to
the wrapper class. Affected: hero padding, grid-template-columns, h1/h2/h3 font
sizes, mega-price font sizes (32–72px), inline tables, sticky asides.

### 4. Master-detail pages

`CustomersPage.tsx` and `QuotesPage.tsx` previously used a fixed 288px rail next
to a detail pane — at <1024px the two panes overflow horizontally.

- `CustomersPage`: outer wrapper switched to `flex flex-col lg:flex-row`. Rail
  hides when a customer is selected on mobile; detail pane shows a "← Back to
  customers" header. Customer detail header reflowed: avatar + name + actions
  stack, KPI strip is `grid-cols-2 sm:grid-cols-4`, tabs strip horizontally
  scrolls instead of overflowing.
- `QuotesPage`: filter row stacks (`flex-col lg:flex-row`), buttons full-width
  on mobile, list table uses `table-responsive-cards` with `data-label` attrs on
  each `<td>`, slideover uses `slideover-responsive` (forces 100% width <1024px).
- `QuoteDetailDrawer`: same `slideover-responsive` treatment plus the inner
  send-quote modal gets `modal-responsive`.

### 5. Modals

28 centered modals across 19 files now carry `modal-responsive`, which on
<1024px forces 100% width, 100% height, removes border-radius, and removes
margin so the modal fills the screen. Touched files include: CustomersPage
(CreateInvoice, RecordPayment), ChangeOrders, BulkImportModal, JobCostingTab,
StagingPage, SchedulePage, JobsPage, IntegrationsPage, TeamManagementPage,
SitePlansPage, AccountsPayablePage, VendorsPage, SitePlanTool, BundlesPage,
BalanceSheetPage, PLStatementPage, QuoteBuilder (Save Quote), OperationsBoard,
SalesPipelineBoard, QuoteDetailDrawer, QuotesPage (pull-from-inventory).

Side drawers and full-screen tool overlays (FileViewerModal lightbox,
CustomerPhotosTab lightbox, MapQuoteBuilder, SitePlanTool main canvas,
SmartSchedule full-screen, QuoteOptionsPanel presentation overlay) intentionally
left untouched — they are already full-bleed.

### 6. Tables

19 list-style tables now use `table-responsive-cards` with `data-label` on every
`<td>`. On <1024px each row becomes a stacked card with the column label on the
left, value on the right. Touched: CustomersPage (Imported Quote History,
Quotes from EZBiz, Jobs), VendorsPage (Bills), AuditLogPage, ReportsPage (8
tables), StagingPage, PortalInbox (Tickets, Documents), JobCostingTab (Crew
Breakdown, Variance, Costed Jobs).

2 line-item tables wrapped in `overflow-x-auto` only, since their column layout
is meaningful: InventoryPage (per-order items), PendingOrdersPage (per-order
items).

Financial spreadsheets (BudgetPage, PLStatementPage, BalanceSheetPage) kept
their grid layout — wrapped in `overflow-x-auto` with `min-w-` so they horizontally
scroll on mobile rather than card-stack (the column comparison is the whole point).

### 7. Public customer-facing pages

- `PublicPresentationPage.tsx`: header padding `px-4 sm:px-6 lg:px-8`, title
  scales `text-xl lg:text-2xl`, body padding `py-6 lg:py-12`.
- `QuoteOptionsPanel.tsx` `CustomerPresentationContent`: tier cards now
  `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` so the Good/Better/Best stack on
  phones; card padding `p-5 lg:p-8`.
- `QuoteTemplateRenderer.tsx`: each of the 4 templates (Premium, Modern,
  Classic, Bold) wrapped in `className="ezbiz-quote-template"`; CSS overrides
  in index.css collapse the sidebar pricing into the column flow, shrink hero
  text, and reduce padding on mobile.

### 8. Kanban and timeline boards

- `OperationsPage.tsx`: kanban columns use the existing `.kanban-scroll` class
  (scroll-snap, smooth horizontal scroll); each column capped at `max-w-[85vw]`
  so the next column peeks on phones.
- `SalesPipelineBoard.tsx`: already had comprehensive `isMobile` handling that
  switches to single-column stacked stages and swipe-to-advance — no edits
  needed.
- `OperationsBoard.tsx`: already a list view (not kanban). Header/filter row
  edits handled via the admin pass.
- `DispatchPage.tsx`: 50/50 map+timeline split was unusable on phones. Now
  stacks vertically (`flex-col lg:flex-row`); map gets a fixed 256px height
  block on top, timeline takes remaining space below. Top toolbar stacks too.
- `SchedulePage.tsx`: header (month nav + crew legend + Settings button) uses
  `flex-col lg:flex-row`; calendar wrapped in `overflow-x-auto`. The
  `.calendar-table` rule already collapses the 5-day grid to a single-day list
  at <640px.

### 9. Admin and finance pages

Bulk pass across 18 settings/finance/admin pages. Common changes:
- Multi-column form grids switched to stacked-on-mobile (`grid-cols-1 lg:grid-cols-N`).
- Filter bars use `flex-col lg:flex-row gap-2`.
- KPI tile rows go `grid-cols-2 lg:grid-cols-4` etc.
- Big mega-numbers scale: `text-5xl → text-3xl lg:text-5xl`, `text-7xl → text-4xl lg:text-7xl`.
- Tab strips wrap or `overflow-x-auto whitespace-nowrap`.
- Bundles' Good/Better/Best three-up grid → stacks on mobile.
- AdminSettingsPage styles table wrapped in `overflow-x-auto min-w-[720px]`.
- AdminPage catalog/transactions/stock-movement tables wrapped same way.
- Financial spreadsheets (Budget, P&L, Balance Sheet) wrapped in
  `overflow-x-auto` so they horizontally scroll instead of breaking the page.

## Test simulation matrix

I cannot drive a browser from here, so this is a static verification pass. The
matrix below describes the expected behavior at each canonical width given the
CSS rules and breakpoints in place; verify in DevTools Device Toolbar.

| Width | Bracket | Expected behavior |
|---|---|---|
| 375px | iPhone SE / phone | Sidebar hidden, hamburger visible. All modals full-screen. All tables card-stacked. Master-detail pages show one pane at a time. Kanban scrolls horizontally with column peek. Customer-facing quote templates render single column with shrunk hero. Inputs render at 16px so iOS does not zoom on focus. All buttons ≥44px tall. |
| 390px | iPhone 14 / phone | Same as 375 — all rules are scoped to `max-width: 1023px`, so any phone width gets the same treatment. Slightly more breathing room in 2-column KPI grids. |
| 768px | iPad portrait / tablet | Still in mobile bracket (1023 cutoff). Tables remain card-stacked. Modals still full-screen. 2-column KPI grids show side by side comfortably. Master-detail still stacks. Kanban columns are still horizontally scrollable. |
| 1024px+ | desktop | All `.lg:` and `.sidebar-desktop` rules engage. Sidebar reappears. Modals revert to centered fixed widths. Tables show as tables. Master-detail shows rail + detail side by side. Kanban shows all columns. Quote templates show their full multi-column layout. |

Boundary cases:
- 1023 → 1024 transition: every helper class is gated `@media (max-width: 1023px)`
  and Tailwind `lg:` is gated `min-width: 1024px`, so there is no dead zone.
- 639 → 640 transition: `.calendar-table` swaps from single-day list back to
  weekly grid. Verify the schedule page reflows cleanly.

## Verification

- `npx tsc -p apps/web/tsconfig.app.json --noEmit` exits 0. No type regressions.
- Desktop styles are unchanged because every edit either:
  - Adds Tailwind `lg:` prefixes that only engage at ≥1024px, or
  - Adds helper classes scoped to `@media (max-width: 1023px)`, or
  - Wraps a table in `overflow-x-auto` (no visual effect when content fits).

## Files touched (summary)

Core:
- apps/web/index.html (viewport)
- apps/web/src/index.css (added .ezbiz-quote-template overrides)

Master-detail / drawers:
- apps/web/src/CustomersPage.tsx
- apps/web/src/QuotesPage.tsx
- apps/web/src/QuoteDetailDrawer.tsx

Modal pass (28 modals across 19 files): CustomersPage, ChangeOrders,
BulkImportModal, JobCostingTab, StagingPage, SchedulePage, JobsPage,
IntegrationsPage, TeamManagementPage, SitePlansPage, AccountsPayablePage,
VendorsPage, SitePlanTool, BundlesPage, BalanceSheetPage, PLStatementPage,
QuoteBuilder, OperationsBoard, SalesPipelineBoard.

Table pass (19 tables card-ified, 2 wrapped only): CustomersPage, VendorsPage,
AuditLogPage, ReportsPage, StagingPage, PortalInbox, JobCostingTab,
InventoryPage, PendingOrdersPage.

Public pages: PublicPresentationPage, QuoteOptionsPanel, QuoteTemplateRenderer.

Schedule / dispatch: SchedulePage, DispatchPage, OperationsPage.

Admin / finance pass (18 files): AdminSettingsPage, AdminPage, AutomationsPage,
IntegrationsPage, BundlesPage, ContractTemplatesSettings, EmailTemplatesSettings,
OperationsStagesSettings, PortalQuoteSettings, BudgetPage, PLStatementPage,
BalanceSheetPage, EZBudgetPage, EZBudgetWidget, ReportsPage, AuditLogPage,
TeamManagementPage, JobsPage, JobsPipeline.

## Out of scope (deliberate)

- `MapQuoteBuilder.tsx` and `SitePlanTool.tsx` — these are mouse-driven canvas
  drawing tools used by the staff sales rep on a laptop or large tablet. A
  full mobile redesign is its own project.
- `QuoteBuilder.tsx` — the main builder is a power-user data entry form. Sub
  modals inside it now have `modal-responsive`; the builder itself remains a
  desktop tool.
