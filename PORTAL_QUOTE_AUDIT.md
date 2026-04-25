# Portal & Quote System Audit

_Date: 2026-04-24_

## 1. Current Customer Portal

**Two portals exist:**
- A **standalone portal sub-app** at [apps/portal/src/client/](apps/portal/src/client/) with its own React app, pages (DashboardPage, DocumentsPage, InvoicesPage, ContractsPage, TicketsPage, KnowledgeBasePage, AdminPage, LoginPage), and backend routes (`/api/auth`, `/api/dashboard`, `/api/invoices`, `/api/documents`, `/api/contracts`, `/api/tickets`). It uses the Prisma `Customer` + `CrmAccount` models with JWT auth.
- **No portal UI inside the main CRM web app.** The main web app's `PortalInbox.tsx` is admin-facing.

**Auto-creation today:** when a new customer is added to the CRM (`CustomersPage.handleSave` → `upsertCustomer`) **no portal account is created**. The CRM customer record (`fencepro_customers`) is a separate namespace from the portal's `Customer` model on the portal DB. No sync.

**Gap:** (a) the portal sub-app is deployable but isolated; (b) there's no auto-invite flow on customer creation; (c) portal accounts aren't linked back to CRM `customer_id`.

**Pragmatic plan for Phase 2–3:** build the portal as a hash-routed path inside the main web app (`/#/portal/*`) so it shares the same localStorage data as the CRM — this is the fastest way to deliver a working portal without cross-app sync. Auto-invite = generate a token + render an email body + store in a new `fencepro_portal_accounts` store.

## 2. Current Quote Send Flow

- **Send button:** `QuoteDetailDrawer.SendQuoteModal` opens a subject/body editor pre-filled from the configurable `quote_sent` email template. On send, the quote flips to SENT, a share token is ensured via `quoteShareStore.ensureShareForQuote`, and a `mailto:` link is opened with the rendered template body.
- **Hosted page:** [PublicQuotePage](apps/web/src/PublicQuotePage.tsx) at `/#/quote/:token`. Shows a generic single-template layout (header, pricing, run breakdown, Accept form). Good baseline but has **no template selection** — every customer sees the same layout.
- **URL structure:** `https://systemssyndicate.com/#/quote/<48+ char token>`. No-login public.
- **Template system:** none. The page hardcodes its design.

## 3. Quote Data Model

`SavedQuote` (localStorage `fencepro_quotes`) fields:
`id, customerId?, customerName, customerPhone, customerEmail, customerAddress, leadSource, salesRep, fenceStyle, runs[], corners, ends, walkGates, dblGates, tearOutSections, tearOutGates, adjLaborHrs, hasSalesman, priceAdjust, sections, materialCost, laborCost, tearOutCost, totalCOGS, finalPrice, gmPct, pullSheet[], status, date, notes, leadTemp`.

**Missing for the quote-template plan:**
- `templateId` / `templateKey`
- `customIntroText`
- `customScopeText`
- `quotePhotos[]`
- `contractBody` (rich text)
- `validityDays`
- `viewedAt`, `viewCount`, `lastViewedAt`
- `acceptedAt`, `acceptedBy`, `acceptedSignature`
- `templateOptions` (per-section show/hide)

## 4. Email System

- **Backend service:** [emailService.ts](apps/portal/src/server/lib/emailService.ts) — SendGrid + SMTP + console fallback; `applyMergeTags`, `buildEmailHtml`.
- **Templates in the CRM:** [emailTemplatesStore.ts](apps/web/src/emailTemplatesStore.ts) — 8 system templates with subject, HTML body, merge tags. Editor is at *Admin → Settings → Email Templates*.
- **Transactional emails configured today:** quote_sent is rendered in the Send Quote modal; the rest are defined but only used when automation actions fire them.
- **Gap:** no portal_welcome email template; no quote_accepted confirmation; no contract PDF delivery.

## 5. Digital Signature System

- `PublicQuotePage` has a name + signature-string capture (not a drawn signature) → writes to `quoteShareStore.stampAccepted(token, name, signature)`.
- `QuoteOptionsPanel.CustomerCard` has a similar typed-signature acceptance for Good/Better/Best options.
- **No drawn-signature canvas.** This is fine and simpler; type-to-sign is legally binding when paired with intent language and a timestamp, and it's what most contractor CRMs use.

## Plan Summary

| Phase | Approach |
|---|---|
| 2 | `portalAccountStore` (token + invite + hashed password); email template `portal_welcome`; activation page at `/#/portal/activate`; Portal Access section on customer profile with Send/Resend. |
| 3 | `/#/portal/*` hash routes: dashboard, quotes, projects, invoices, documents, photos, messages, account, login — all read from the shared localStorage data, styled with a clean customer-facing theme (white, company accent, top nav). |
| 4 | Extend `SavedQuote` with new fields; add `quoteTemplatesStore` with 4 built-in templates; build `QuoteTemplateRenderer` that renders any quote+template to HTML; add picker UI to `QuoteDetailDrawer` or QuoteBuilder. |
| 5 | Replace `PublicQuotePage` with a template-aware version; records `viewedAt`/`viewCount` on load; acceptance flips status SENT→SOLD and runs the signed-contract cascade. |
| 6 | `contractStore` with 7 editable sections + `ContractTemplatesSettings` component under Admin → Settings. |
| 7 | Engagement columns on the internal Quotes list, icons per row, first-view notification to rep. |
| 8 | Portal + Quote settings panels in AdminSettingsPage with the listed toggles. |
| 9 | Verification doc. |

Proceeding to Phase 2.
