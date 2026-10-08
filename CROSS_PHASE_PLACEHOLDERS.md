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
imported quotes list (`fencepro_imported_quotes`) moved to the server on
2026-10-07.

---

## Phase 3 — Jobs + Operations Board

**RESOLVED 2026-05-09.** SavedJob model + /api/saved-jobs CRUD shipped;
jobStore.ts is API backed; banners on Jobs and Costing tabs removed.
Job costing entries (`fencepro_jobcosting`) moved to the server on 2026-10-07
and now feed the P&L.

---

## Phase 8 — Integrations

| File | Element | Banner location | Action when Phase 8 lands |
|---|---|---|---|
| [apps/web/src/CustomerPhotosTab.tsx](apps/web/src/CustomerPhotosTab.tsx) | CompanyCam sub tab (only visible when `localStorage.fencepro_integrations.companycam.connected`) | Honest message inside the sub tab: "Live photos from CompanyCam will appear here once the integration is fully wired on the portal backend." | Move CompanyCam linkage off `localStorage.fencepro_integrations` and onto the existing `Integration` table; wire sub tab to fetch real photos from CompanyCam API |

---

## Phase 9 — Settings, P&L, Balance Sheet, Automations, Email Templates, Billing

**RESOLVED 2026-10-07 on the `finalize` branch.** Invoices and payments are
part of the business state the server stores per company; the two browser
test confirms an invoice and a partial payment made in one browser appear in
another. The banner on the customer Billing tab is removed.

---

## Other (no fixed phase number)

**Updated 2026-10-07 on the `finalize` branch.** These are resolved and their
entries removed: legacy files and site plans, the materials staging board, job
costing entries, imported quotes (all now stored on the server through
`/api/kv`, see `apps/web/src/cloudStorage.ts`), and the Automations and
Integrations pages (both use the server routes with the signed in user).

Still open:

| File | Element | Banner location | Action |
|---|---|---|---|
| [apps/web/src/CustomerPortalApp.tsx](apps/web/src/CustomerPortalApp.tsx) | Customer portal reads shared quotes and files (`fencepro_quote_shares`, `fencepro_files`) from the browser's own storage | None | Give the portal a customer scoped read of the same data from the server. Until then a customer on their own device does not see them in the portal; the public quote link (`#/quote/:token`) does work from any device |
| [apps/web/src/PublicPresentationPage.tsx](apps/web/src/PublicPresentationPage.tsx) | Customer-facing presentation page company branding | Renders default 'EZBiz' instead of company name when no inline mirror is present | Add a server-side public branding endpoint (e.g. GET `/api/saved-quotes/share/:token` returns company snapshot) so customer browsers without `fencepro_config` mirror still see proper branding |
| [apps/web/src/billingStore.ts](apps/web/src/billingStore.ts) | `createNote / updateNote / deleteNote / getNotesForCustomer` | None — dead code since Phase 1 migration | Safe to delete in a future cleanup pass; Phase 1 already routes the Notes tab through `/api/crm-contacts/:id/notes` |
