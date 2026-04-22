# Bug Audit — FencePro CRM

_Date: 2026-04-21_

## 1. Address Autocomplete

**Works:** [MapQuoteBuilder.tsx:26-63](apps/web/src/MapQuoteBuilder.tsx#L26-L63) — uses `google.maps.places.Autocomplete` via `loadPlaces()` from [mapsLoader.ts](apps/web/src/mapsLoader.ts). Same pattern in [SitePlanTool.tsx](apps/web/src/SitePlanTool.tsx).

**Broken:** Every other address field is a plain `<input>`. [CustomersPage.tsx:261](apps/web/src/CustomersPage.tsx#L261) (service address), [CustomersPage.tsx:270](apps/web/src/CustomersPage.tsx#L270) (billing address), [QuoteBuilder.tsx](apps/web/src/QuoteBuilder.tsx) customer address, [VendorsPage.tsx](apps/web/src/VendorsPage.tsx) vendor address — none load the Places library.

**Root cause:** No shared `AddressAutocomplete` component. The autocomplete logic is inlined in MapQuoteBuilder and never extracted.

**Fix:** Phase 3 — extract shared `AddressAutocomplete.tsx` and swap into every address field.

## 2. Data Persistence Crisis

The CRM is **almost entirely localStorage-backed**. There is a portal backend (Express + Prisma + PostgreSQL) but the CRM web app rarely calls it.

**localStorage-only stores** (audited):
- `fencepro_customers` — [CustomersPage.tsx:1136](apps/web/src/CustomersPage.tsx#L1136)
- `fencepro_quotes` — [App.tsx](apps/web/src/App.tsx)
- `fencepro_jobs` — [jobStore.ts](apps/web/src/jobStore.ts)
- `fencepro_pipeline` — [JobsPage.tsx:116](apps/web/src/JobsPage.tsx#L116)
- `fencepro_invoices`, `fencepro_payments` — [billingStore.ts](apps/web/src/billingStore.ts)
- `fencepro_vendors`, `fencepro_vendor_bills` — [vendorStore.ts](apps/web/src/vendorStore.ts)
- `fencepro_pl_entries`, `fencepro_bs_entries` — [financeStore.ts](apps/web/src/financeStore.ts)
- `fencepro_bundles`, `fencepro_quote_options` — [bundleStore.ts](apps/web/src/bundleStore.ts)
- `fencepro_inventory`, `fencepro_files`, `fencepro_siteplans`, `fencepro_customer_notes`, etc.

**Real risks:**
1. **localStorage lives on the browser** — clearing cache, using incognito, or switching devices loses everything.
2. **No 401 handling** — [portalSync.ts](apps/web/src/portalSync.ts) silently swallows errors with `catch(() => {})`. If the token expires mid-session, saves fail silently.
3. **No save feedback** — most save buttons return to neutral state immediately; user has no idea if save succeeded.
4. **`portalSync.syncQuote` is fire-and-forget** — [App.tsx:322](apps/web/src/App.tsx#L322) `syncQuote(q).catch(() => {})` — if the portal is down, no one knows.

**Fix:** Phase 2 — add toast system, global fetch wrapper with 401 handling, and save-state feedback. Keep localStorage as source of truth for now (migrating every store to the server is outside the scope of a bug-fix pass), but ensure any server calls that *do* happen surface failures.

## 3. Map Quote Save Flow

[App.tsx:330](apps/web/src/App.tsx#L330) — `handleMapQuoteData` receives `MapFenceData` from the map tool and opens `QuoteBuilder` **pre-filled with the address only** — no `customerId`, `customerName`, `customerPhone`, `customerEmail`.

When Save is clicked in QuoteBuilder, the quote is persisted via `handleSaveQuote` with empty customer fields unless the user manually types them in the SaveModal.

**Result:** Map quotes can be saved with no customer association, and they won't appear on any customer's Quotes tab.

**Fix:** Phase 2 — require customer selection in the SaveModal before allowing save; disable save button with a clear hint if customer not chosen.

## 4. Customer Creation → Pipeline

[CustomersPage.tsx:1131](apps/web/src/CustomersPage.tsx#L1131) `handleSave` only updates `fencepro_customers`. It does **not** touch `fencepro_pipeline`. Pipeline seeding only happens on the first render of JobsPage from customers that already existed ([JobsPage.tsx:78-113](apps/web/src/JobsPage.tsx#L78-L113)).

**Result:** A customer created today will not appear on the Sales Pipeline until `fencepro_pipeline` is cleared and re-seeded.

**Fix:** Phase 4 — on customer create, push a new pipeline lead at "First Contact".

## 5. Site Plan Save Flow

[SitePlanTool.tsx:38](apps/web/src/SitePlanTool.tsx#L38) saves to `fencepro_siteplans`. No `customerId` field on the saved record. No write to `fencepro_files`.

**Result:** Site plans are never linked to a customer, never appear in the customer's Files tab.

**Fix:** Phase 5 — add `customerId` to site plan shape, provide customer picker in SitePlanTool, mirror an entry to `fencepro_files` on save.

## 6. Quote from Customer Profile

[App.tsx:679](apps/web/src/App.tsx#L679) — `<CustomersPage onNewQuote={() => { setEditingQuote(null); setShowQuote(true) }} />` — the `onNewQuote` callback is called with no customer context. QuoteBuilder opens blank.

**Fix:** Phase 8 — pass the selected customer ID up, seed `editingQuote` with customer fields, show the customer as pre-selected in the SaveModal.

## 7. Map Quote / New Quote Button Placement

[App.tsx:649-664](apps/web/src/App.tsx#L649-L664) — rendered in the global header with condition:

```js
(active === 'Customers' || active === 'Quotes' || active === 'Dashboard')
```

**Result:** Visible on Dashboard, Customers, and Quotes. (Spec says only Quotes.)

**Fix:** Phase 7 — change condition to `active === 'Quotes'`.

## 8. Pull Sheet / Inventory

[inventoryStore.ts](apps/web/src/inventoryStore.ts) has `pullFromInventory` on quote save, but there is **no pending-order concept** — nothing that represents "materials reserved for a sold job but not yet ordered from supplier".

`getJobByQuoteId` is used to auto-create a Job when status flips to SOLD ([App.tsx:297](apps/web/src/App.tsx#L297)). Pull sheet is linked to customer but not queued for ordering.

**Fix:** Phase 9 — new `pendingOrderStore` with `pending_orders` + `pending_order_items`; on SOLD transition create a pending order from the pull sheet.

## 9. Additional Bugs Found

- **`portalSync.syncQuote` silent failure** ([App.tsx:322](apps/web/src/App.tsx#L322)) — `.catch(() => {})`. Even when the user is online, they never know a sync failed. → Phase 2 toast.
- **No loading state on Save buttons** — the Save button in CustomersPage ([line 1131](apps/web/src/CustomersPage.tsx#L1131)) returns to neutral instantly. → Phase 2 save states.
- **Cached `SAMPLE_CUSTOMERS` / `SAMPLE_QUOTES` / `SAMPLE_JOBS`** — ([CustomersPage.tsx:1100, 1103, 1104](apps/web/src/CustomersPage.tsx#L1100)) — sample data is displayed when localStorage is empty. Fine for dev, confusing in prod. → accept as-is; seed is opt-in.
- **`quotes` / `jobs` in CustomersPage are hardcoded** — `customerQuotes`, `customerJobs` never pull real saved quotes. They filter `SAMPLE_QUOTES` with `customerId`. → Phase 10 fix: read from `fencepro_quotes` and `fencepro_jobs`.
- **401 never triggers re-auth** — `crmAuth.ts` manages token storage but no interceptor resets on 401. → Phase 2.
- **`confirm()` dialogs block saves in some paths** — not a bug per spec, but `window.confirm` for destructive actions is inconsistent UX.
- **No `customerId` on quotes saved from MapQuoteBuilder flow** — see Bug 3.
- **File upload stores base64 in localStorage** — [CustomersPage.tsx Files tab](apps/web/src/CustomersPage.tsx) — means ~5MB quota trap. Photos tab in Phase 6 must use object URLs or S3.
- **Photo tab missing entirely** — addressed in Phase 6.
- **Inventory decrement happens only when quote is first saved**, not when transitioning to SOLD — that's wrong timing; materials shouldn't be decremented at quote time. → Phase 9 restructures.

Proceeding to Phase 2.
