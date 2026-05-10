# Phase 9 Placeholder Audit (Settings + P&L + Balance Sheet + Email Templates + Budget + Billing)

**Date:** 2026-05-09
**Scope:** AdminSettingsPage, EmailTemplatesSettings, PLStatementPage, BalanceSheetPage, BudgetPage, ReportsPage, AutomationsPage, IntegrationsPage, BillingPage, billingStore, financeStore, configStore, emailTemplatesStore.

## Findings

| # | Element | Status | Notes |
|---|---|---|---|
| 1 | AdminSettingsPage company info form | WORKS | configStore.saveConfig flushes to API + mirrors localStorage. |
| 2 | AdminSettingsPage fence styles editor | WORKS | Same configStore path. |
| 3 | AdminSettingsPage pricing config (man-hour rate, commissions) | WORKS | configStore. |
| 4 | EmailTemplatesSettings edit / save / reset | WORKS | emailTemplatesStore via businessStateStore. |
| 5 | PLStatementPage manual entries | WORKS | financeStore.getPlEntries / createPlEntry / updatePlEntry / deletePlEntry. |
| 6 | PLStatementPage recurring entries auto-fill | WORKS | ensureRecurringForPeriod flows through cache. |
| 7 | BalanceSheetPage manual entries | WORKS | financeStore.getBsEntries / createBsEntry / updateBsEntry / deleteBsEntry. |
| 8 | BalanceSheetPage company name | WORKS | Inline `fencepro_config` read mirrored by configStore. |
| 9 | BudgetPage editor (revenue / overhead / labor / materials targets) | WORKS | Bridged in Phase 9 commit; mirrors `fencepro_budget` for App.tsx + ReportsPage inline reads. |
| 10 | ReportsPage budget pull | WORKS | Reads `fencepro_budget` mirror. |
| 11 | App.tsx loadBudget for dashboard | WORKS | Same mirror. |
| 12 | BillingPage invoice list + filters | **FIXED** | billingStore.getInvoices was reading `localStorage.fencepro_invoices` directly. Routed through `businessStateStore.invoices`. |
| 13 | BillingPage payments list | **FIXED** | billingStore.getPayments was localStorage. Routed through `businessStateStore.payments`. |
| 14 | BillingPage create invoice + line items | **FIXED** | createInvoice writes flow through API. |
| 15 | BillingPage record payment | **FIXED** | recordPayment writes flow through API. |
| 16 | Customer profile pull sheets tab | **FIXED** | billingStore.getPullSheetsForCustomer + linkPullSheetToCustomer were localStorage. Routed through `businessStateStore.pullSheets`. |
| 17 | Pull sheet auto-link from sold quote (signedContractFlow) | WORKS | Same store path now sees the API write. |
| 18 | plEngine.ts (P&L derivation from invoices) | WORKS | Reads invoices via billingStore (now API backed). |
| 19 | AutomationsPage automation rules editor | DEPENDS_ON_LATER_PHASE [later] | The active server already has Automation + AutomationRunLog Prisma models with /api/automations routes (per project context). The frontend AutomationsPage was not migrated as part of Phase 9 because it calls the server's existing automation API directly, not through localStorage. Verify wiring in a follow up. |
| 20 | IntegrationsPage Stripe / Twilio / GoogleCalendar / etc. | DEPENDS_ON_LATER_PHASE [later] | Reads `localStorage.fencepro_integrations` for connection status. The active schema has `Integration` + `IntegrationLog` models with /api/integrations routes; frontend wiring is a separate sub-task (per project context most live integrations are untested). |
| 21 | Customer notes (legacy billingStore.create/update/deleteNote) | DEAD CODE | Phase 1 migrated CustomerNotesTab to /api/crm-contacts/:id/notes. The billingStore note helpers are no longer called by anyone; left in place to avoid removing public exports unrelated to this audit. Safe to delete in a future cleanup pass. |

## Verdict

**Phase 9 done.** Five real fixes (billingStore invoices, payments, pull sheets — all four entry points migrated). Schema gained four new BusinessState sub-fields (`invoices`, `payments`, `statements`, `pullSheets`).

Two items left as cross-phase placeholders:
- **AutomationsPage frontend wiring** — backend exists; needs the page to consume `/api/automations` instead of localStorage. Logged in `CROSS_PHASE_PLACEHOLDERS.md`.
- **IntegrationsPage frontend wiring** — backend exists; needs the page to consume `/api/integrations` and migrate `localStorage.fencepro_integrations`. Logged.
