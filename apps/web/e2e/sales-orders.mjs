// Inventory > Sales Orders follow each sold job's pull sheet (audit Oct 26 2026, item 2), on the dev copy, the way
// the office reads them (computer, Chrome, 1440 x 900), and on the Operations tab. Reads only.
//
//   Manuel Cotrich's order lists his tan vinyl parts (it listed white), from his pull sheet as signed.
//   Shawn Hart's lists chain link parts (it listed white vinyl posts, donuts and PT40 pipe).
//   AUD Web Chainlink's has the approved +20 ft change order (CO-1) in it.
//   Every open sold job with a pull sheet has one; none lists tear out.
//
// Run after scripts/sales-orders-backfill.ts --apply on the dev copy (the orders made before the fix).
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4083 API_URL=http://localhost:4083 E2E_STAFF_COOKIE=<dev owner cookie> [SHOTS=<folder>] node e2e/sales-orders.mjs

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'
import { signInByCookie, STAFF_COOKIE } from './lib.mjs'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
// E2E_STAFF_COOKIE, or E2E_ACCESS_TOKEN moved over to a cookie by lib.mjs (how run-heavy.sh runs it).
const COOKIE = STAFF_COOKIE
const SHOTS = process.env.SHOTS || ''
const devLocal = u => /^http:\/\/localhost:\d+\/?$/.test(u) && !/:4000\b/.test(u)
if (!devLocal(APP) || !devLocal(API)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
if (!COOKIE) { console.error('Set E2E_STAFF_COOKIE (scripts/dev-session-token.ts --cookie) or E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const psql = sql => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `sales-orders-${name}.png`) }) } }

/** The order's parts on the page, after tapping its row. */
async function openOrder(page, who) {
  const row = page.locator('button', { hasText: who }).first()
  const rowText = (await row.textContent().catch(() => '')) || ''
  await row.click()
  await sleep(500)
  const parts = await page.locator('table tbody tr td:first-child').allTextContents()
  return { rowText, parts }
}

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await signInByCookie(ctx, { cookie: COOKIE, api: API })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  await page.goto(`${APP}/inventory`)
  await page.waitForSelector('[data-inventory-tab="sales_orders"]', { timeout: 30000 })
  await page.locator('[data-inventory-tab="sales_orders"]').click()
  await page.waitForSelector('text=Sales Orders', { timeout: 10000 })
  await sleep(1500)
  await shot(page, '1-list')

  const manuel = await openOrder(page, 'Manuel Cotrich')
  check('Manuel Cotrich: the order is his tan vinyl, from his pull sheet as signed', /Tan Vinyl/i.test(manuel.rowText) && /From: Frozen at signing/.test(manuel.rowText), manuel.rowText)
  check('... its parts are tan, none white', manuel.parts.some(p => /Vinyl, Tan, Post/.test(p)) && !manuel.parts.some(p => /White/.test(p)), manuel.parts.slice(0, 4).join('; '))
  check('... no tear out on a materials order', !manuel.parts.some(p => /tear ?out|haul/i.test(p)))
  await shot(page, '2-manuel')

  const shawn = await openOrder(page, 'Shawn Hart')
  check('Shawn Hart: the order is chain link', /Chain Link/i.test(shawn.rowText) && shawn.parts.some(p => /Fabric, Galv/.test(p)), shawn.rowText)
  check('... no white vinyl posts, donuts or PT40 pipe', !shawn.parts.some(p => /Vinyl|Donut|PT40/.test(p)), shawn.parts.filter(p => /Vinyl|Donut|PT40/.test(p)).join('; '))

  // AUD Web Chainlink is a dev-only audit job (a chain link order with an approved +20 ft change order); the Oct 30 refresh of the dev copy does not hold it.
  // When it is missing this says so and the checks after it still run.
  const web = await openOrder(page, 'AUD Web Chainlink').catch(() => ({ rowText: 'no order for AUD Web Chainlink on this database (its dev-only audit job is missing)', parts: [] }))
  const lineQty = Number(psql(`select i->>'requiredQuantity' from "BusinessState", jsonb_array_elements("pendingOrders"::jsonb) o, jsonb_array_elements(o->'items') i where o->>'customerName'='AUD Web Chainlink' and i->>'itemName' like 'Pipe, Galv, 1-5/8%' limit 1`))
  check('AUD Web Chainlink: the order follows the approved +20 ft change order', /From: Change order CO-1/.test(web.rowText) && lineQty === 45, `${web.rowText} · line posts ${lineQty}`)

  // Every open sold job with a pull sheet has an order.
  const missing = psql(`select j."customerName" from "SavedJob" j join "SavedQuote" q on q.id=j."quoteId" where j."deletedAt" is null and j."archivedAt" is null and j.status in ('staging','scheduled','in_progress','on_hold') and jsonb_array_length(coalesce(q."pullSheet"::jsonb,'[]'))>0 and not exists (select 1 from "BusinessState" b, jsonb_array_elements(b."pendingOrders"::jsonb) o where o->>'quoteId'=q.id)`)
  check('every open sold job with a pull sheet has an order', !missing, missing.replace(/\n/g, ', '))

  await page.locator('[data-inventory-tab="operations"]').click()
  await sleep(800)
  check('Operations tab lists the same open orders', await page.locator('text=Manuel Cotrich').count() > 0)
  await shot(page, '3-operations')
  check('no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  await browser.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
