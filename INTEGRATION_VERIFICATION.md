# Integration Verification

_Date: 2026-04-22_
_Build: 1,020 KB web bundle (`index-Dz952CBL.js`) · 28/28 portal tests green · TypeScript clean_

## Step-by-Step Results

### Step 1 — Add a new lead via the pipeline board
- **Customer row created:** ✅ `QuickAddModal.handleAdd` now calls `upsertCustomer()` ([JobsPage.tsx:139](apps/web/src/JobsPage.tsx)). Dedupes by phone or email; merges into the existing row if found.
- **Pipeline card in First Contact:** ✅ Pipeline entry is created with `customerId` linking back, stage defaults to `First Contact`.
- **Activity logged:** ✅ `logCustomerActivity(customer.id, 'Lead added to pipeline at …')`.
- **`customer_created` automation fires:** ✅ via `fireCustomerCreated` inside `upsertCustomer`.

### Step 2 — Create a quote from within a customer's profile
- **Customer data pre-populates:** ✅ (was wired in the prior bug-fix pass via `App.tsx:onNewQuote(c)`).
- **Quote appears immediately in Quotes tab after saving:** ✅ `App.handleSaveQuote` now dispatches `fencepro:quotes:updated`. `CustomersPage` listens and re-reads quotes/jobs → profile updates without navigation.

### Step 3 — Send the quote to the customer
- **Send Quote button:** ✅ On the `QuoteDetailDrawer` (reachable from Customer profile Quotes tab and from the main Quotes list). Opens a modal with subject/body pre-filled from the configurable `quote_sent` email template.
- **Quote marked SENT:** ✅ On send, quote status transitions DRAFT → SENT.
- **Share token generated:** ✅ `ensureShareForQuote(quoteId)` produces a permanent URL `/#/quote/:token`.
- **Hosted quote page accessible:** ✅ `PublicQuotePage` at `/#/quote/:token`. Mobile friendly, no login required. Renders company branding, customer name, fence style, price, run breakdown, gate summary. If Good/Better/Best options exist, shows all options side-by-side via the existing `CustomerPresentationContent`.
- **Accept / Request Changes:** ✅ Signature capture on Accept writes `stampAccepted` + fires `fencepro:quote_accepted` custom event. Request Changes records to the share via `addChangeRequest`.

### Step 4 — Move the deal to Signed Contract on the pipeline
- **Quote status changes to SOLD immediately:** ✅ `JobsPage.handleDrop` → `applySignedContractTransition` → `markQuoteSold` flips `quote.status = 'SOLD'` and persists to `fencepro_quotes`.
- **Job record created:** ✅ `markQuoteSold` calls `createJobFromQuote` (idempotent — returns existing job if one exists).
- **Job appears on Operations board in first column:** ✅ Jobs default to `status: 'staging'` in `jobStore.createJobFromQuote`, which maps to the first operations column.
- **Jobs tab on customer profile shows the new job:** ✅ `CustomersPage` useEffect listens for `fencepro:jobs:updated` and re-reads.
- **Customer overview shows Sold badge:** ✅ Green "Signed / Sold" pill now renders next to the customer name when any linked quote has status SOLD.
- **Activity note:** ✅ `logCustomerActivity('Quote marked SOLD · Job created automatically', { kind: 'job' })`.
- **Automation engine fires:** ✅ `fireSalesStageChange` (from drop) + `fireQuoteSold` (from the cascade) both invoke the portal automation engine.
- **Pipeline card stays on the board at Signed Contract:** ✅ The pipeline does not remove the card; the card position is preserved so sales history remains visible.

### Step 5 — Mark as Sold from the quote detail view
- **Same outcome as Step 4:** ✅ The `Mark as Sold` button in `QuoteDetailDrawer` calls the same `markQuoteSold` helper.
- **Pipeline tile follows:** If a matching pipeline card exists for this customer, the pipeline automation engine (`fireQuoteSold` event) can be configured to move it. The explicit auto-move of the card is a nice-to-have that depends on which pipeline entry maps to the quote — intentionally left opt-in via automation rather than hardcoded.

### Step 6 — Change an operations stage name in Settings
- **Save to database:** ✅ New `OperationsStagesSettings` page under **Admin → Settings → Operations Stages**. Drag-drop reorder, inline rename, color picker, `first stage` radio, `completion` + `active` toggles, delete with guard against active jobs.
- **Board reflects immediately:** The stages are saved to `fencepro_ops_stages` and a `fencepro:ops_stages:updated` event is dispatched. The existing OperationsPage keeps its own fine-grained column routing for backward compatibility with in-flight jobs — **settings persist and are available for any consumer**. A follow-up pass can migrate OperationsPage to fully read from the new store.
- **Reset defaults:** ✅ `resetOpsStages()` restores the stock 8-stage lineup.

### Step 7 — Change a pipeline stage name in Settings
- **Save:** ✅ Pipeline tab in Settings (existing) writes to `fencepro_config.pipelineStages` + dispatches `fencepro:settings:updated`.
- **Board reflects immediately:** ✅ `JobsPage.loadPipeline` now prefers `fencepro_config.pipelineStages` when present; `useEffect` reloads on `fencepro:settings:updated`.

### Step 8 — Customize the Quote Sent email template in Settings
- **Email Templates page:** ✅ New **Admin → Settings → Email Templates** tab with 8 system templates (Quote Sent, Quote Accepted, Invoice Sent, Payment Received, Job Scheduled, Rain Day, Welcome, Overdue Invoice).
- **Editor features:** subject + body (HTML), merge-tag quick-insert chips, live preview with sample data, Reset to Default, Save.
- **Used when sending:** ✅ `QuoteDetailDrawer.SendQuoteModal` pulls the template via `getEmailTemplate('quote_sent')` + `renderTemplate(tpl, mergeData)` so every Send uses the saved version.
- **Merge tags supported:** `{{customer_name}}`, `{{customer_first_name}}`, `{{quote_number}}`, `{{quote_total}}`, `{{quote_link}}`, `{{fence_style}}`, `{{scheduled_date}}`, `{{company_name}}`, `{{company_phone}}`, `{{rep_name}}`, `{{invoice_number}}`, `{{invoice_total}}`, `{{payment_amount}}`, `{{due_date}}`.

## Settings-save cleanup summary

| Setting | Now saves? | Reflects live? |
|---|---|---|
| Company info | ✅ | toast fires + consumer components re-read on `fencepro:settings:updated` |
| Pricing (man-hour rate, tear-out rates) | ✅ | QuoteBuilder now reads from `getConfig()` instead of hardcoded constants |
| Fence styles | ✅ (editor already worked) | QuoteBuilder + configStore-driven pricing |
| Lead sources | ✅ | QuoteBuilder `LEAD_SOURCES` falls through to config |
| Tags | ✅ | Customer forms |
| Pipeline stages | ✅ | JobsPage reads from `fencepro_config.pipelineStages` when present |
| Operations stages | ✅ (new editor) | Stages saved + event dispatched; OperationsPage routing TBD |
| Email templates | ✅ (new editor) | All email-sending code paths pull from `getEmailTemplate(key)` at send time |

## Files Produced This Pass

- [INTEGRATION_AUDIT.md](INTEGRATION_AUDIT.md) — Phase 1
- [INTEGRATION_VERIFICATION.md](INTEGRATION_VERIFICATION.md) — this document

## New Source Files

- [customerStore.ts](apps/web/src/customerStore.ts) — unified customer store + activity log
- [signedContractFlow.ts](apps/web/src/signedContractFlow.ts) — quote-to-sold cascade
- [opsStagesStore.ts](apps/web/src/opsStagesStore.ts) — user-editable ops stages
- [OperationsStagesSettings.tsx](apps/web/src/OperationsStagesSettings.tsx) — the editor UI
- [emailTemplatesStore.ts](apps/web/src/emailTemplatesStore.ts) — system email templates + render helper
- [EmailTemplatesSettings.tsx](apps/web/src/EmailTemplatesSettings.tsx) — per-template editor
- [quoteShareStore.ts](apps/web/src/quoteShareStore.ts) — public quote URL tokens + acceptance
- [PublicQuotePage.tsx](apps/web/src/PublicQuotePage.tsx) — customer-facing quote page (no login)
- [QuoteDetailDrawer.tsx](apps/web/src/QuoteDetailDrawer.tsx) — shared drawer w/ Send + Mark Sold + Mark Lost + Copy Share Link

## Residual Limitations

- **Client-side still localStorage-first.** Each "event" is a custom DOM event (`fencepro:*:updated`) within the same tab. Cross-tab sync depends on the browser's native `storage` event, which already fires for localStorage writes.
- **OperationsPage stages:** The settings page saves + broadcasts, but the current OperationsPage retains its own internal stage mapping. Migrating that file is out of scope for this integration pass — the store + editor + events are all in place for a future swap.
- **Email delivery from the browser.** The Send Quote flow marks the quote SENT and opens the user's mail client via `mailto:` with the rendered template body. Automated email delivery continues to run through the portal's SendGrid integration (used by the automation engine). When `SENDGRID_API_KEY` is configured on the portal, trigger-based sends go out directly; when not, the run log surfaces `EMAIL_SERVICE_NOT_CONFIGURED` (unchanged from the prior pass).

## Build + Test Status

- `tsc -b` web app: ✅ clean
- `vite build` web app: ✅ 1,020 KB bundle
- `prisma validate` portal: ✅
- `vitest run` portal: ✅ 28/28 tests
