# FencePro CRM — V2 Audit

Date: 2026-04-13

---

## 1. Inventory Module

### Files
- `apps/web/src/AdminPage.tsx` — 6-tab inventory UI (Dashboard, Catalog, Stock Movement, Transaction History, Bundles, Locations)
- `apps/web/src/inventoryStore.ts` — data store with 289 default items

### Data Model
```
InventoryItem: id, name, sku?, unitCost (number), category, supplier?, unitOfMeasure?, status, qtyOnHand?, reorderPoint?, reorderQty?, maxQty?, locationId?
StockLevel: itemId, locationId, quantity, minQuantity, maxQuantity, reorderPoint, reorderQty, lastUpdated
InventoryTransaction: id, itemId, itemName, locationId, type (stock_in|stock_out|adjustment|transfer|pull_sheet), quantityDelta, quantityAfter, unitCost?, referenceId?, referenceType?, notes, createdAt, createdBy?, toLocationId?, isReversalOf?, reversedBy?
InventoryLocation: id, name, address?, type (warehouse|yard|truck|virtual), isActive
Bundle: id, name, description, items: BundleItem[]
```

### localStorage Keys
- `fencepro_inventory`, `fencepro_bundles`, `fencepro_inv_locations`, `fencepro_inv_stock`, `fencepro_inv_transactions`

### Import/Export
- **No bulk import** exists — items are managed one at a time or via default seed
- **No CSV/Excel import** functionality
- **No import history** or saved sheet support
- Stock Movement tab allows batch in/out but not bulk item creation
- PO generation exists (PurchaseOrder.tsx) but creates print HTML from quote pull sheets, not structured data

---

## 2. Settings Module

### Files
- `apps/web/src/AdminSettingsPage.tsx` — 6 tabs: Company, Pricing, Fence Styles, Lead Sources, Tags, Pipeline
- `apps/web/src/configStore.ts` — AppConfig interface, defaults, localStorage persistence

### Pricing Fields and Data Types
| Field | Default | Storage Type | UI Display | Input Type |
|-------|---------|-------------|------------|------------|
| manHourRate | 22 | number | $22.00 | type="number" step="0.50" min="0" |
| commissionSalesman | 0.10 | number (decimal) | 10% | type="number" step="0.5" (×100 display) |
| commissionNonSalesman | 0 | number (decimal) | 0% | type="number" step="0.5" |
| tearOutFence | 9.50 | number | $9.50 | type="number" step="0.50" min="0" |
| tearOutGate | 27.00 | number | $27.00 | type="number" step="0.50" min="0" |
| margins.good | 0.34 | number (decimal) | 34% | type="number" step="0.5" (×100 display) |
| margins.warning | 0.27 | number (decimal) | 27% | type="number" step="0.5" (×100 display) |

### Fence Style Numeric Fields
| Field | Type | Example |
|-------|------|---------|
| margin | number (decimal) | 0.64 |
| sectionsPerMH | number | 1.2 |
| panelWidth | number (int) | 6 |
| mhPerWalkGate | number | 2.4 |
| mhPerDblGate | number | 4.8 |

### Known Numeric Issues
1. Commission/margin fields multiply by 100 for display, divide by 100 on save — floating-point error risk (e.g., 0.1 × 100 / 100 ≠ 0.1 exactly)
2. All values stored in localStorage as JSON (JavaScript number type) — no precision guarantees
3. `parseFloat(e.target.value) || 0` fallback masks invalid input silently
4. No input validation messages — user gets no feedback on bad values

---

## 3. Job Costing

### File
- `apps/web/src/JobCostingTab.tsx` — standalone component (~800 lines)

### Where It Lives
- Currently rendered as a tab inside `BudgetPage.tsx` (under Finance → Budget → Job Costing tab)
- NOT inside any customer detail view

### Data Sources
- Quotes: `fencepro_quotes` localStorage
- Cost entries: `fencepro_jobcosting` localStorage

### JobCostEntry Interface
```
id, quoteId, completionDate, actualLaborHrs, crew: CrewEntry[], actualMaterialCost, actualOtherCosts, notes
```

### Calculations
- laborHrsVariance = actual - estimated
- materialVariance = actual - quoted
- totalActCOGS = actualLabor + actualMaterial + actualOther
- cogsVariance = actualCOGS - estimatedCOGS
- actualGM = (finalPrice - actualCOGS) / finalPrice

### Variance Color Coding
- Green: within 5%, Yellow: within 15%, Red: over 15%

---

## 4. Customer Detail Page

### File
- `apps/web/src/CustomersPage.tsx` (~750 lines)

### Tabs
1. **Overview** — contact details, billing address, notes
2. **Quotes** — imported quote history + FencePro quotes
3. **Jobs** — referenced but minimal
4. **Files** — referenced but minimal

### Customer Interface
```
id, firstName, lastName, phone, email, serviceAddress, billingAddress, billingDifferent, leadSource, notes, tags[], createdAt, salesRep, firstApptDate, jobStatus?
```

### What's Missing
- **No Job Costing tab** — costs are only visible in Budget → Job Costing
- No automation history per customer
- No purchase order history per customer

---

## 5. Schedule Module — Drag & Drop

### Unscheduled Job Cards
- Layout: `grid grid-cols-3 gap-2` (3 per row)
- Card size: `border border-gray-200 rounded-xl p-3` — fairly large
- Fields shown: client name, fence type + sections, job price
- Missing: address/city, phone, stage badge
- Drag: `draggable` + `onDragStart={e => e.dataTransfer.setData('staging', JSON.stringify(s))}`

### Drop Zone (Calendar Day Cell)
- Handler: `onDragOver={e => e.preventDefault()}` + `onDrop` handler
- **NO visual highlight** when dragging over a day cell
- No background color change, no border highlight, no "drop here" text
- Cell styling: plain `<td>` with `align-top px-3 py-2 border-r border-gray-100`

### Scheduled Job Cards (in Calendar)
- Crew color with 15% opacity background + 3px left border
- Shows: rain day emoji (if flagged), client name, fence type, sections, price
- Hover: rain day button + delete button (opacity-0 → opacity-100)

### Rain Day
- Modal: reason select + reschedule date/TBD + cancel/confirm
- Log: collapsible panel with entries (client, original date, reason, reschedule, flagged date)
- Weather widget: 5-day forecast strip (OpenWeatherMap)
- Weather on calendar cells: temp + emoji per day
- Automation trigger: `fireRainDayFlagged()` on flag

---

## 6. Order/PO Creation

### File
- `apps/web/src/PurchaseOrder.tsx` — generates print-ready HTML, not structured data

### How POs Work
- `generatePO(quote, vendor?, notes?)` creates HTML string
- Opens in new browser window, auto-triggers `print()`
- PO number: `PO-{quoteId.slice(0,6).toUpperCase()}`
- Data from: quote pull sheet items, company info from configStore
- Template: professional HTML with header, info grid, items table, totals, signature lines

### What's Missing
- POs are **not stored** — they're ephemeral print documents
- No link to jobs (only to quotes)
- No draft/review/confirm workflow
- No auto-generation from job stage changes
- No supplier-level PO consolidation
- Change Orders exist separately (ChangeOrders.tsx) linked to quotes by quoteId

---

## Changes Log (updated as phases complete)

_To be filled in as Phases 2-6 are completed._
