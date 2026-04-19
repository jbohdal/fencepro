# Finance & Quote System Audit

_Date: 2026-04-18_
_Scope: Pre-implementation audit for P&L, Balance Sheet, AP, and Good/Better/Best bundles_

## 1. Reports & Budget — Current State

**Reports page** (`apps/web/src/ReportsPage.tsx`, 2,112 lines):
- **Pure derivation from quotes.** All charts pull from `localStorage.getItem('fencepro_quotes')` — the `SavedQuote[]` array produced by `QuoteBuilder`.
- Charts: revenue by month, close rate, margin trend, fence-type mix, lead-source ROI, etc.
- No real P&L. No EBITDA. No expense roll-up. No invoice-based revenue.
- `loadBudget()` reads `fencepro_budget` from localStorage to render target vs actual comparisons.

**Budget page** (`apps/web/src/BudgetPage.tsx`, 1,616 lines):
- Backed by `localStorage.fencepro_budget` (no server).
- `BudgetState` fields: `revenueGoal`, `overheadPct`, `laborPct`, `materialsPct`, `netProfitPct`, `employees[]`, `overhead[]`, `historic[]`, `seasonality[]`.
- **Overhead chart of accounts** already modeled in `DEFAULT_OVERHEAD` with `{id, label, annual, category}` + parent/child hierarchy (Advertising, Rent, Insurance, Payroll-Overhead, etc.).
- **Employees** modeled with hourly rate and annual hours — direct labor for COGS math.
- Includes `JobCostingTab` (imported at line 2) for per-job labor/material actuals.

**Implication for P&L:** the budget already has a chart-of-accounts structure and labor/overhead modeling. But all numbers are _target/annualized projections_, not transaction-level actuals. Our new P&L must combine real transactions (invoices + vendor bills) with optional manual entries, not try to derive from the Budget page's annualized figures.

## 2. Billing — Current State

**Storage:** `apps/web/src/billingStore.ts` — localStorage-backed. No server tables yet.

**Invoice tables (localStorage):**
- `fencepro_invoices`: `Invoice { id, customerId, customerName, jobId?, invoiceNumber, title, status, lineItems[], subtotalCents, taxRate, taxCents, discountCents, totalCents, amountPaidCents, balanceDueCents, dueDate, issuedDate, sentAt?, paidAt?, voidedAt?, notes, createdBy, createdAt, updatedAt }`
- `Invoice.status` enum: `draft | sent | viewed | partially_paid | paid | overdue | void`
- `fencepro_payments`: `Payment { id, invoiceId, invoiceNumber, customerId, customerName, amountCents, paymentMethod, referenceNumber, paymentDate, recordedBy, notes, createdAt }`
- `PaymentMethod` enum: `cash | check | credit_card | bank_transfer | payment_link | other`

**Also in portal Prisma schema:** a separate `Invoice` model exists for the _customer portal_ (different purpose — externalCrmId-keyed, used by the support portal). This is **not** the CRM billing invoice; keep both and don't conflate them.

**Aging already implemented:** `getBillingSummary(customerId)` produces `agingCurrent / 1-30 / 31-60 / 61-90 / 90+` buckets and `getARSummary()` rolls it up for the full AR aging dashboard visible in `BillingPage.tsx`.

**BillingPage.tsx:** shows three tabs — Aging Report, Overdue, Payments. No vendor/AP concept.

**Implication for P&L Revenue source:** use `getInvoices()` filtered to `status in (paid, partially_paid)`. For monthly grouping use `issuedDate` (or `paidAt` for cash-basis; we'll use `issuedDate` for accrual, which matches standard P&L convention).

## 3. Vendor / Accounts Payable Tables

**None exist.** Grepped for `vendor`, `payable`, `AccountsPayable`, `bill_line` — zero matches in:
- `apps/portal/prisma/schema.prisma`
- `apps/web/src/billingStore.ts`
- `apps/web/src/*.ts(x)` stores
- Portal routes

This is a clean green-field build for Phase 2 tables: `vendor_contacts`, `vendor_bills`, `vendor_bill_line_items`, `vendor_payments`.

## 4. Quote Creation Flow

**Table/storage:** `localStorage.fencepro_quotes` — array of `SavedQuote`.

**Shape** (from `apps/web/src/QuotesPage.tsx`):
```
SavedQuote {
  id, customerName, customerPhone, customerEmail, customerAddress,
  leadSource, salesRep, customerId?,
  fenceStyle,                              // string name, not an ID
  runs: number[],                          // run lengths in feet
  corners, ends, walkGates, dblGates,
  tearOutSections, tearOutGates, adjLaborHrs,
  hasSalesman, priceAdjust,
  sections, materialCost, laborCost, tearOutCost,
  totalCOGS, finalPrice, gmPct,
  pullSheet: LineItem[],                   // materials pull sheet
  status: 'DRAFT' | 'SENT' | 'SOLD' | 'LOST',
  date, notes, leadTemp
}
```

**Pricing engine** (`QuoteBuilder.tsx` + `materialCalculator.ts`):
- Inputs: fence style + runs + gates + tear-out + labor adjust.
- Sections calculated per run using `sectionsForRun(ft, panelWidth)`.
- Labor hours = sections / `style.sectionsPerMH` + gate hours.
- Labor cost = labor hours × `MAN_HOUR_RATE (22)`.
- Materials from `calculateMaterials()` in `materialCalculator.ts` returning a `LineItem[]` pull sheet.
- Tear-out: flat per-unit rates (`TEAR_OUT_FENCE=$9.50`, `TEAR_OUT_GATE=$27.00`).
- Final price uses per-style `margin` (the "magic number") to back-compute price from COGS: `price = totalCOGS / (1 - style.margin)`.
- Commission added if `hasSalesman` (10% from config).

**Key implication for Good/Better/Best:** the pricing engine is driven by `style.margin` and `MAN_HOUR_RATE` — both values we need to _override per bundle tier_ without mutating the underlying style config. Phase 6 bundle records will carry `margin_override` and `labor_rate_override` fields that Phase 6's "Generate Options" flow reads before running the calc.

## 5. Fence Styles & Pricing Config

**Where defined:** `apps/web/src/configStore.ts` — `AppConfig.fenceStyles[]` stored in `localStorage.fencepro_config`.

**FenceStyle shape:**
```
{ id, name, category: 'Vinyl'|'Chainlink'|'Commercial'|'Aluminum'|'Other',
  margin, sectionsPerMH, panelWidth, mhPerWalkGate, mhPerDblGate, isActive }
```

**PricingConfig:**
```
{ manHourRate: 22, commissionSalesman: 0.10, commissionNonSalesman: 0,
  tearOutFence: 9.50, tearOutGate: 27.00 }
```

**MarginThresholds:** `{ good: 0.34, warning: 0.27 }` — used for GM color-coding only.

**Also duplicated:** `QuoteBuilder.tsx` has a hardcoded `FENCE_STYLES` array (lines 6–33). Both locations use the same style IDs, so Phase 6 bundle records can key on `fenceStyleId` referencing these stable IDs.

**For bundle tier overrides:** bundle record stores optional `margin_override`, `labor_rate_override`, `price_per_foot_override`, `material_markup_percent`. If override present, swap it into the calc for that tier; otherwise fall back to the style's defaults from `configStore`.

## 6. Existing Tiers / Packages / Options

**None.** No existing Good/Better/Best, tier, package, option, or bundle concept in the quote system.

EZ Budget module (separate public-widget quoting tool at `EzBudgetService`/`EzBudgetQuote`/`EzBudgetLineItem`) has _line items_ but no tier/package structure — it's a flat service catalog with quantity × unit price. Phase 6 does not need to touch EZ Budget; the Good/Better/Best bundles live on the internal CRM `SavedQuote` side only.

## 7. Existing Budget Module — What's Tracked

Per `BudgetPage.tsx` / `BudgetState`:

- **Targets:** `revenueGoal`, `overheadPct`, `laborPct`, `materialsPct`, `netProfitPct` (plus product-mix % for vinyl/aluminum/chainlink).
- **Employees:** `{ name, role, hourlyRate, annualHours }` — six default crew (Chris, Juan, + 4 TBD) with Foreman/CO-Foreman/Installer roles.
- **Overhead:** ~30 line items with parent/child hierarchy across categories (Sales, Facilities, Operations, Admin, Finance). Annual dollar budget per line.
- **Historic:** 5 years (2021–2025) of monthly revenue.
- **Seasonality:** 12 monthly % weights (Jan 1.75% ... Jun 15.08% ... Dec 1.57%).

**Actuals tracking:** `JobCostingTab` records per-job labor hours / material spend on jobs — the closest thing to transaction-level cost data today. Not structured enough to back a P&L by itself; will supplement vendor bills as a labor-COGS source in Phase 3.

---

## Build Summary — What Phase 2+ Must Add

| Need | Status |
|---|---|
| Vendor master / contacts | **create** `vendor_contacts` |
| Vendor bills (AP) | **create** `vendor_bills` + `vendor_bill_line_items` |
| Vendor payments | **create** `vendor_payments` |
| Manual P&L entries (depreciation, owner salary, etc.) | **create** `pl_manual_entries` |
| Balance sheet manual entries | **create** `balance_sheet_entries` |
| Bundle / tier / GBB system | **create** `quote_bundles`, `quote_bundle_inclusions`, `quote_bundle_addons`, `quote_options` |
| Invoices (AR) | **reuse** existing `billingStore` invoices |
| Overhead chart-of-accounts | **reuse** existing `BudgetPage` overhead model (informational only) |
| Fence styles / margins | **reuse** `configStore.fenceStyles` as source of truth for bundle calc |
| Job costing labor | **reuse** `JobCostingTab` records as COGS direct-labor source |

Green-lit to proceed with Phase 2.
