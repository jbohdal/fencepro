# EZBiz — Known Issues

_Last updated: 2026-04-26_

Prioritized list of issues that exist but were not fixed in this audit pass. Each entry includes severity, current workaround (if any), and a rough effort estimate.

## Priority Scale
- **P0 / Critical** — Data loss, security exposure, or broken core flow. Fix now.
- **P1 / High** — Functional gap that real customers will hit. Fix soon.
- **P2 / Medium** — Quality or scale issue. Plan into next sprint.
- **P3 / Low** — Polish or nice-to-have.

---

## Architectural

### #1 — Multi-tenant data isolation is not implemented (P0)

**The reality:** Most user data lives in browser `localStorage` keyed by `fencepro_*` (customers, quotes, jobs, pipeline, invoices, vendor bills, inventory, schedules, etc.). The portal data plane (photos, documents, messages) and authentication tables (`PortalAccount`, `CrmUser`, `CrmUserSession`) are server-side.

**Why it's a blocker:** The system can serve a single company per browser today. The "millions of companies on EZBiz" goal requires:
- Every user-data table on the server with a `companyId` column.
- Every query scoped by the authenticated user's `companyId`.
- Migration path for the existing localStorage-resident data into per-company tables.

**Workaround today:** Each user uses their own browser; data is implicitly isolated by browser.
**Effort:** 2-4 weeks of focused work — schema changes, query rewrites, data migration tool, cross-tenant test suite.

### #2 — Trade-agnostic terminology not implemented (P2)

The prompt's Phase 20 ask: replace fence-specific language ("Awaiting Locates", fence styles in dropdowns) with configurable trade-agnostic stages. The estimating engine and EZ Budget remain fence-specific by design.

**Workaround today:** Operations / pipeline stage names are already configurable in settings. Default seed is fence-specific.
**Effort:** ~2 days — make seeded defaults a function of the new "Business Type" setting, audit dashboard / portal copy for trade-specific phrasing.

### #3 — Float-money columns in Prisma schema (P1)

`QuoteBundle.marginOverride`, `QuoteBundle.laborRateOverride`, `QuoteBundle.materialMarkupPercent`, `QuoteOption.marginPercent`, and frontend `POLineItem.unitCost`/`total` are stored as `Float`/`number` rather than integer cents/basis-points.

**Risk:** IEEE-754 rounding drift accumulates across many bundles or POs.
**Workaround:** Limited blast radius today (small data volumes).
**Effort:** ~1 day with migration. Convert to `Int` (cents for dollars, basis points for percentages), backfill via SQL, update reads/writes.

### #4 — Frontend bundle is monolithic (~1.16 MB minified) (P2)

Vite warns on chunks over 500 kB. The CRM and customer portal share a bundle.

**Workaround:** Acceptable on broadband, slow on mobile.
**Effort:** ~1 day — route-level code splitting via `React.lazy`.

---

## Security

### #5 — `inviteTokenHash` field on `CrmUser` is reused for password-reset (P2)

Two flows (initial invite acceptance and password reset) write to the same column. Each flow reads expiry correctly, but the field name is misleading and a future code change could conflate them.

**Workaround:** Logic correctness is fine today.
**Effort:** ~2 hours — rename to two fields with a Prisma migration.

### #6 — CSP header is not configured (P3)

`helmet()` was hardened (HSTS, referrer policy) but Content-Security-Policy is intentionally disabled because the app uses inline styles + Google Maps + SendGrid img pixels and a real CSP needs careful per-endpoint testing.

**Workaround:** XSS risk is low — the app sanitizes user inputs before storage.
**Effort:** ~1 day — write CSP, test in staging, iterate.

### #7 — Refresh token theft window (P3)

If a refresh token is leaked, the attacker can use it once to mint new credentials and the legitimate user gets logged out on next refresh — but the attacker now has a new token. Standard JWT-with-rotation tradeoff.

**Workaround:** Monitor "refresh token reused" events as a signal.
**Effort:** ~1 day — add reuse detection + automatic session revocation on suspicious event.

---

## Integrations (untested — need credentials)

### #8 — SendGrid sender not verified (P0)

Per prior session screenshot, the sender domain is unverified. All transactional emails (invites, invoices, quote sends) fail with 403. The frontend falls back to a `mailto:` handoff so the user can send manually.

**Workaround:** mailto fallback works.
**Effort:** ~30 min — verify sender in SendGrid console + match `SMTP_FROM_EMAIL` env.

### #9 — Stripe webhook untested (P1)

Code path exists but no live webhook endpoint test has been performed. Without verification, marking an invoice paid via Stripe checkout may silently fail.

**Workaround:** Manual payment recording works.
**Effort:** ~1 hour — register webhook URL, fire a test event from Stripe CLI, verify invoice updates.

### #10 — QuickBooks OAuth flow not exercised (P2)

OAuth code is present but unverified end-to-end with real credentials.
**Effort:** ~2 hours — connect a sandbox QB account, push one invoice, verify it lands.

### #11 — Twilio SMS untested (P2)

`sms.ts` is wired but never run with real Twilio creds in this audit.
**Effort:** ~30 min — set creds, fire a test from automation engine.

### #12 — Other integrations (CompanyCam, Connecteam, Zapier outbound) (P2)

All wired in code, none exercised in this audit.

---

## UX / Frontend

### #13 — Real-time UI for payment recording (P2)

Recording a payment doesn't immediately update the invoice list and balance UI in `BillingPage` — relies on the user navigating away and back, or the custom event reaching subscribed components.

**Workaround:** Reload of the tab.
**Effort:** ~1 hour — dispatch `fencepro:invoices:updated` after `recordPayment`.

### #14 — Customer / quote create has no save spinner (P3)

Submit buttons don't visibly disable during save. On a slow connection a user can double-click and create duplicates (mitigated by store de-dupe but visually confusing).

**Workaround:** Save is fast (<200ms) on broadband.
**Effort:** ~30 min per form.

### #15 — Modal forms are not full-screen on mobile (P2)

CustomerForm / QuoteBuilder / SaveModal float at desktop sizes on small viewports.
**Effort:** ~2 hours — responsive sweep on the modal wrapper.

### #16 — Email/phone format validation is HTML-only (P3)

`type="email"` and `type="tel"` are inconsistent and unreliable on mobile browsers.
**Effort:** ~30 min — add JS regex validation on submit.

### #17 — Empty states are inconsistent (P3)

Some pages have proper empty-state UI (CustomersPage), others fall back to bare "No data" strings (BillingPage tabs, JobsPage). 
**Effort:** ~2 hours — extract `EmptyState` component, apply to ~6 pages.

---

## Data integrity

### #18 — Missing `onDelete` behavior on several FK relations (P2)

Document → Customer, Document → CrmAccount, Ticket → CrmAccount, Invoice → CrmAccount, Contract → CrmAccount, ChatConversation → Customer.

**Risk:** Deleting a parent row leaves orphan children if the DB allows it (DB defaults to RESTRICT in Postgres which is safe; the issue is implicit behavior).
**Workaround:** No UI deletes parents today; soft-delete pattern is adopted on portal entities.
**Effort:** ~1 hour to add explicit `onDelete: Cascade` / `Restrict` per relation, then `prisma db push`.

### #19 — Soft-delete is inconsistent across tables (P3)

`Document`, `PortalPhoto`, `PortalFile`, `PortalMessage` have `deletedAt`. `Ticket`, `Invoice`, `Contract`, `Customer`, `Lead`, `Appointment` do not.

**Risk:** No way to undo a destructive action on those tables.
**Effort:** ~3 hours — schema add + global query helper.

### #20 — Orphan-detection script does not exist (P3)

The prompt asked for `/scripts/find-orphans.ts`. Not implemented in this pass — would require choosing a runtime target (Node CLI vs. admin API) and threading auth.

**Effort:** ~3 hours.

---

## Operational

### #21 — `/health` doesn't include version / uptime (P3)

After this audit it now pings DB. Doesn't include app version.
**Effort:** ~10 min — read from `package.json`.

### #22 — Logs aren't structured (P3)

`console.log` / `console.error` throughout. No request-id, no JSON output, no log shipping config.
**Effort:** ~half-day to add `pino` or similar.

### #23 — No Sentry / error reporting (P2)

Server-side errors hit `console.error` and disappear. No alerting on 500s.
**Effort:** ~1 hour to add Sentry SDK.

---

## Notes
- Issues called out in audits but not actionable here (e.g., float math in QuoteOption that no current UI surfaces) are still listed for completeness.
- Anything marked **P0** should be fixed before onboarding any new paying customer.
- `localStorage.fencepro_*` keys are intentionally NOT renamed in Phase 0 — renaming wipes user data. They become irrelevant once #1 lands.
