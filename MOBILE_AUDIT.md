# FencePro CRM — Mobile Responsiveness Audit

Date: 2026-04-16

---

## 1. CSS Setup

- **Framework:** Tailwind CSS v4.2.2 via `@tailwindcss/vite` plugin
- **Entry point:** `apps/web/src/index.css` — imports Tailwind
- **Additional CSS:** `apps/web/src/App.css` — 185 lines with 6 `@media (max-width: 1024px)` queries (legacy, target `#center`, `#next-steps`, `#docs` elements)
- **All component styling:** Tailwind utility classes inline — no CSS modules, no styled-components

---

## 2. Existing Responsive Breakpoints

### Tailwind Responsive Classes Found (5 files out of 37)
| File | Classes Used |
|------|-------------|
| IntegrationsPage.tsx | `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` |
| SchedulePage.tsx | `grid-cols-4 lg:grid-cols-6` |
| EZBudgetWidget.tsx | `lg:grid-cols-3`, `sm:grid-cols-3`, `sm:grid-cols-2` |
| EZBudgetPage.tsx | `lg:grid-cols-4`, `lg:grid-cols-3` |
| ReportsPage.tsx | `lg:grid-cols-3` |

**32 of 37 component files have ZERO responsive classes.**

### App.css Media Queries
6 queries all at `@media (max-width: 1024px)` targeting legacy layout elements. None target mobile.

---

## 3. Pages / Views Checklist

| # | Page Name | Component | Nav Group |
|---|-----------|-----------|-----------|
| 1 | Dashboard | App.tsx (inline) | Sales |
| 2 | Customers | CustomersPage.tsx | Sales |
| 3 | Quotes | QuotesPage.tsx | Sales |
| 4 | Sales Pipeline | JobsPipeline.tsx | Sales |
| 5 | Operations | OperationsPage.tsx | Operations |
| 6 | Schedule | SchedulePage.tsx | Operations |
| 7 | Dispatch | DispatchPage.tsx | Operations |
| 8 | Site Plans | SitePlanTool.tsx | Operations |
| 9 | Inventory | AdminPage.tsx | Operations |
| 10 | Reports | ReportsPage.tsx | Finance |
| 11 | Budget | BudgetPage.tsx | Finance |
| 12 | EZ Budget | EZBudgetPage.tsx | Admin |
| 13 | Automations | AutomationsPage.tsx | Admin |
| 14 | Integrations | IntegrationsPage.tsx | Admin |
| 15 | Portal Inbox | PortalInbox.tsx | Admin |
| 16 | Settings | AdminSettingsPage.tsx | Admin |

**Plus overlays:** QuoteBuilder, MapQuoteBuilder, SmartSchedule, BulkImportModal, JobCostingTab

---

## 4. Navigation System

### Sidebar (App.tsx lines 388-469)
- Container: `w-56` (224px) / `w-16` (64px) when collapsed
- **No responsive classes** — always visible, no `hidden lg:block`
- Collapse toggle: manual button, desktop-only UX
- `mobileMenuOpen` state exists (line 176) but is **completely unused in JSX**

### Header Bar (App.tsx lines 476-517)
- Fixed padding: `px-6 py-3`
- Search bar: `w-64` (256px) — fixed width
- Action buttons: not stacked, no responsive wrap

### Existing Mobile Behavior
**None.** No hamburger, no drawer, no responsive hide/show.

---

## 5. Problematic Components

### Fixed-Width Modals (9+)
| File | Width | Component |
|------|-------|-----------|
| ChangeOrders.tsx | w-[560px] | Change order modal |
| JobsPipeline.tsx | w-[560px] | Job detail drawer |
| SchedulePage.tsx | w-[480px], w-[560px] | Settings, rain day modal |
| BulkImportModal.tsx | w-[800px] | Import wizard |
| JobCostingTab.tsx | w-[640px] | Cost entry modal |
| QuoteBuilder.tsx | w-[480px] | Quote form |
| IntegrationsPage.tsx | w-[480px], w-[400px] | Connect + API key modals |
| SitePlanTool.tsx | w-[480px] | Plan settings |
| OperationsPage.tsx | w-[480px] | Job detail slide-over |

### Hardcoded Grids (40+ locations)
- `grid-cols-5`: 10+ files (Dashboard KPIs, stats strips)
- `grid-cols-4`: 15+ files (card layouts, stat grids)
- `grid-cols-12`: 6 files (table-like data grids)
- `grid-cols-3`: 10+ files (card grids)

### Drag and Drop (4 files)
- SchedulePage.tsx — job cards
- DispatchPage.tsx — dispatch blocks
- StagingPage.tsx — staging cards
- JobsPage.tsx — pipeline cards
- **No touch alternative exists**

### Wide Tables (15 files)
All use fixed padding (`px-6`, `px-3`) with no responsive scaling. Every table will require horizontal scroll or card conversion on mobile.

### Fixed Content Widths
- Main content: `px-8 py-6` (32px horizontal padding on every page)
- Search bar: `w-64` (256px)
- SmartSchedule panel: `w-72` (288px)

---

## 6. Viewport Meta Tag

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
```
- `width=device-width` ✓
- `initial-scale=1.0` ✓
- `maximum-scale=1.0` — prevents pinch zoom (accessibility concern but acceptable for app)
- `user-scalable=no` — same
- PWA meta tags present (apple-mobile-web-app-capable, theme-color) ✓

---

## Summary

| Category | Issue Count | Severity |
|----------|-----------|----------|
| Sidebar always visible (no mobile nav) | 1 | CRITICAL |
| Fixed-width modals > 390px | 9+ | CRITICAL |
| Hardcoded multi-column grids | 40+ | HIGH |
| Tables with no responsive | 15 | HIGH |
| Drag-and-drop only (no touch) | 4 | HIGH |
| Fixed padding (px-8) | All pages | MEDIUM |
| Fixed search bar width | 1 | MEDIUM |
| No responsive classes | 32/37 files | HIGH |

**Current mobile usability estimate: ~10-15%** — the app is desktop-only.
