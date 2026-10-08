# Browser tests

These drive the real app in a real browser against a real server and
database. They are the automated version of the "two browser sync test":
one browser makes changes, a second brand new browser logs in and has to see
them.

**They write test data. Run them against a local, empty database only.** The
scripts refuse to run unless both URLs are localhost.

## What each one covers

| Script | Checks |
|---|---|
| `two-browser-sync.mjs` | Inventory, settings, vendors, customers, quotes, jobs, checklists, pipeline, schedule, job costing, change orders, site plans and billing all reach a second browser. A new browser logging in wipes nothing. A save made with an expired login still lands. A module that failed to load refuses to save. |
| `intake.mjs` | A website quote and a phone agent call each become a customer, a note and a pipeline card. Repeat contact makes no duplicates. |
| `every-screen.mjs` | Every screen opens with no console errors, failed requests or blank pages. |

## Running them

1. A local Postgres with an empty database, and the server pointed at it:

   ```bash
   cd apps/portal
   export DATABASE_URL=postgresql://USER@127.0.0.1:5432/ezbiz_test
   npx prisma db push
   npx tsx scripts/create-owner.ts you@example.com 'a-test-password' 'Your Name' 'Test Co'
   JWT_SECRET=local-test-secret JWT_REFRESH_SECRET=local-test-refresh \
     EZ_QUOTE_WIDGET_TOKEN=test-widget-token RETELL_API_KEY=key_test \
     DISABLE_CRON=1 PORT=4000 npx tsx src/server/index.ts
   ```

2. The web app, in another terminal:

   ```bash
   cd apps/web && npx vite --port 5173
   ```

3. Playwright, once:

   ```bash
   pnpm add -D -w playwright && npx playwright install chromium
   ```

4. The tests, each on a freshly emptied database:

   ```bash
   cd apps/web/e2e
   export E2E_EMAIL=you@example.com E2E_PASSWORD='a-test-password'
   node two-browser-sync.mjs
   EZ_QUOTE_WIDGET_TOKEN=test-widget-token RETELL_API_KEY=key_test node intake.mjs
   node every-screen.mjs
   ```

`two-browser-sync.mjs` and `intake.mjs` assert exact counts, so empty the
database between runs (drop and recreate it, `prisma db push`, create the
owner again).
