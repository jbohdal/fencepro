# Phase 2 Placeholder Audit (Quotes)

**Date:** 2026-05-09
**Scope:** QuotesPage, QuoteBuilder, QuoteDetailDrawer, QuoteOptionsPanel, QuoteTemplateRenderer, MapQuoteBuilder, PortalQuoteSettings, PublicQuotePage, PublicPresentationPage.

## Findings

| # | Element | Status | Notes |
|---|---|---|---|
| 1 | QuotesPage list / status pills / filters | WORKS | Reads via getQuotes() store cache; updateQuote on status / leadTemp change. |
| 2 | QuotesPage row click → QuoteDetailDrawer | WORKS | Drawer onChange refreshes from store. |
| 3 | QuoteBuilder save (DRAFT / SENT / SOLD / LOST) | WORKS | upsertQuote routes through API; auto-create job + pending order on first SOLD preserved. |
| 4 | QuoteBuilder mark-as-sold cascade (signedContractFlow) | WORKS | markQuoteSold reads/writes via store now. |
| 5 | QuoteDetailDrawer "Send" mailto handoff | WORKS | Status flips to SENT through updateQuote when it was DRAFT. |
| 6 | QuoteDetailDrawer template picker | WORKS | updateQuote writes templateKey through store. |
| 7 | PublicQuotePage GET via share token | WORKS | fetchPublicQuoteByToken; no auth needed. |
| 8 | PublicQuotePage Accept signature | WORKS | acceptPublicQuoteByToken POST flips status SOLD; firstViewedAt + viewCount tracked. |
| 9 | PublicPresentationPage company branding | DEPENDS_ON_LATER_PHASE [n] | Reads `localStorage.fencepro_config` which is empty in customer browsers. Will fall back to "EZBiz" defaults. Needs server-side public branding endpoint to render proper company info / logo on customer-facing presentation pages. Logged in CROSS_PHASE_PLACEHOLDERS.md. |
| 10 | QuoteTemplateRenderer contract sections | **FIXED** | Was reading legacy `fencepro_contract_sections` localStorage key. Switched to `getContractSections()` from contractStore so the latest cloud contract sections show. |
| 11 | PortalQuoteSettings save | **FIXED** | Was writing `localStorage.fencepro_config` directly (bypassing configStore so the Portal/Quote/Notifications settings would not sync). Switched to `getConfig()` + `saveConfig()`. |
| 12 | QuoteOptionsPanel Good/Better/Best | WORKS | Reads via getOptions / saveOptions which now flow through businessStateStore. |
| 13 | MapQuoteBuilder map drawing → quote save | WORKS | Save handler routes through QuoteBuilder which uses upsertQuote. |

## Verdict

**Phase 2 done.** All BROKEN / FAKE items fixed in this audit pass (PortalQuoteSettings + QuoteTemplateRenderer). Customer-facing public presentation branding logged as a cross-phase placeholder (no server endpoint for public branding yet).
