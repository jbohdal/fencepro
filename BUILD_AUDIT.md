# Build & Deployment Audit
**Date:** 2026-04-29 (UTC)
**Site audited:** https://www.systemssyndicate.com

---

## TL;DR — the live site is 4 days and 27 files behind the source tree

The live deploy of EZBiz at systemssyndicate.com is running an older build. **None of the work from the last several development prompts has been deployed to production.** Everything compiles cleanly locally; nothing has been shipped.

Action required to make all that work visible to real users:
1. Commit the working-tree changes
2. Run `prisma migrate deploy` against the production database (one new table: `CrmContact`)
3. Run `pnpm build` on the production server
4. Restart the API process (PM2 / systemd / whatever the VPS uses)
5. Reload nginx if any path-routing rules changed (none did in this set of changes)

Detailed checklist in [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md).

---

## 1. Source vs build vs live — three timelines

| Layer | State | Evidence |
|---|---|---|
| **Live HTML** | `Last-Modified: Sat, 25 Apr 2026 03:25 UTC` | `curl -I https://www.systemssyndicate.com/` |
| **Live JS bundle** | `index-C221DKPI.js` | `<script src=…>` in live `index.html` |
| **Live `<title>`** | `FencePro CRM` (the rename to "EZBiz" is not deployed) | Playwright probe |
| **Local fresh build** | `index-BLdi1tO3.js` (Apr 28 23:12) | `apps/web/dist/assets/` mtime |
| **Local source** | 27 modified files + 9 new files uncommitted on `main` | `git status --short` |
| **Latest commit on `main`** | `30c4f91 Fix critical portal activation bug — move tokens to the server` | `git log --oneline` |

### Files modified but uncommitted

```
M  apps/portal/README.md
M  apps/portal/prisma/schema.prisma
M  apps/portal/src/client/index.html
M  apps/portal/src/server/index.ts
M  apps/portal/src/server/integrations/adapters/zapier/index.ts
M  apps/portal/src/server/lib/emailService.ts
M  apps/portal/src/server/lib/followUpScheduler.ts
M  apps/portal/src/server/lib/googleCalendar.ts
M  apps/portal/src/server/lib/sms.ts
M  apps/portal/src/server/routes/crm-auth.ts
M  apps/portal/src/server/routes/portal.ts
M  apps/web/index.html
M  apps/web/src/AccountsPayablePage.tsx
M  apps/web/src/App.tsx
M  apps/web/src/BalanceSheetPage.tsx
M  apps/web/src/CustomerPhotosTab.tsx
M  apps/web/src/CustomerPortalApp.tsx
M  apps/web/src/CustomersPage.tsx
M  apps/web/src/JobsPage.tsx
M  apps/web/src/LoginPage.tsx
M  apps/web/src/OperationsPage.tsx
M  apps/web/src/PLStatementPage.tsx
M  apps/web/src/PublicPresentationPage.tsx
M  apps/web/src/PublicQuotePage.tsx
M  apps/web/src/QuoteDetailDrawer.tsx
M  apps/web/src/QuoteTemplateRenderer.tsx
M  apps/web/src/configStore.ts
```

### New files uncommitted

```
?? apps/web/src/CustomerFilesTab.tsx
?? apps/web/src/CustomerMessagesTab.tsx
?? apps/web/src/MessagesInbox.tsx
?? apps/web/src/SalesPipelineBoard.tsx        (new vertical-swimlane Sales Pipeline)
?? apps/web/src/OperationsBoard.tsx           (new vertical-swimlane Operations)
?? apps/web/src/portalApiClient.ts
?? apps/web/src/crmContactsApi.ts             (new: dual-write client)
?? apps/portal/src/server/routes/crm-contacts.ts   (new REST API for CrmContact)
?? apps/portal/src/server/lib/urls.ts         (new: buildFrontendUrl + env validator)
+ several documentation markdown files
```

---

## 2. Build status

| Build | Status |
|---|---|
| `apps/web` — `npx tsc -b` | ✅ clean, no errors |
| `apps/web` — `npx vite build` | ✅ built in 217 ms, bundle 1.20 MB / 267 KB gzipped |
| `apps/portal` — `npx tsc -p tsconfig.server.json --noEmit` | ✅ clean |
| `apps/portal` — `npx prisma generate` | ✅ Prisma Client v6.19.3 generated for the new `CrmContact` model |

There are **no build errors**. The working tree is in a deployable state.

---

## 3. Live evidence (Playwright walk against production)

`fencepro-qa/live-audit.js` was run against https://systemssyndicate.com using the real CRM credentials. Full report in [`fencepro-qa/live-audit-report.json`](fencepro-qa/live-audit-report.json) and screenshots in `fencepro-qa/screenshots-live-audit/`.

```
✗ [Build]      Live page title: "FencePro CRM"          (rename to EZBiz not deployed)
✗ [Build]      Live JS bundle: index-C221DKPI.js        (4 days old)
✓ [Auth]       Login with real credentials: authenticated
✗ [Brand]      Sidebar shows EZBiz: still "FencePro Management Platform"
✗ [Pipeline]   New swimlane layout: 0 swimlanes (still horizontal kanban)
✗ [Operations] New swimlane layout: 0 lanes  (still horizontal kanban)
✗ [Operations] Unscheduled lane present: no
✗ [API]        GET  /api/crm-contacts: 404
✗ [API]        POST /api/crm-auth/invites/resend-all-pending: 404
✗ [Mobile]     FAB visible at 390px: no
✗ [Mobile]     Stage pills visible at 390px: no
✓ [Customers]  Customer list renders: 6 clickable rows
✓ [API]        POST /api/crm-auth/login: 400 (route exists, body invalid → expected)
✓ [API]        POST /api/portal/login: 400 (route exists)
✓ [API]        POST /api/portal/activate: 400 (route exists)
```

The pattern is consistent: **everything that existed before the last 4 days of work is live and functioning. Nothing built in the recent prompts is live.**

---

## 4. What "the build is stale" means in this case

This is a self-hosted nginx + Node deploy:

```
$ curl -sI https://www.systemssyndicate.com/
HTTP/1.1 200 OK
Server: nginx/1.24.0 (Ubuntu)
Date: Wed, 29 Apr 2026 03:23:36 GMT
Last-Modified: Sat, 25 Apr 2026 03:25:27 GMT   ← that's the deploy
ETag: "69ec3427-33e"
```

So nginx is serving an `index.html` that was last written on Apr 25. Behind nginx, the Node API process was started at the same point. Neither has been refreshed since.

The frontend asset filename `index-C221DKPI.js` confirms it's a Vite build (Vite produces `index-[contenthash].js`). Cache-busting works correctly — when the user deploys the new build, browsers will pick up the new `index-BLdi1tO3.js` (or whatever hash the next build produces) automatically. **No stuck-cache problem to fix.**

---

## 5. Process restart status

I cannot inspect the live PM2 / systemd process from here. But because the **served HTML's `Last-Modified` is Apr 25 and the API endpoints from the last fix-pass return 404**, it is certain that:

- The Node API process was last restarted on or before Apr 25.
- The frontend dist directory served by nginx was last replaced on or before Apr 25.
- Whatever CI / deploy hook normally pushes changes is either not running or has been disabled.

A single deploy + restart cycle puts everything live.

---

## 6. Build errors found

**None** in the local build. Both `tsc` and `vite build` are clean. There is no partial-build situation in the source tree.

---

## 7. Why the deploy hasn't happened

The development work has been correctly built and tested locally over multiple prompts but **no commit, push, or deploy step was ever triggered** in those sessions. This is by design — I don't run `git commit` or push without explicit authorization. The work is sitting in the working tree, ready to ship.

The single action that unblocks everything: follow [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md).
