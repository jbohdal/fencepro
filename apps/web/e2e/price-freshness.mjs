// Material price freshness.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev token> SHOTS=<folder> node e2e/price-freshness.mjs
//
// A quote warns about parts whose Inventory price is old or never confirmed,
// and "Open in Inventory" shows just those parts. Confirm price changes only
// the date, a changed cost gets today's date, the bulk confirm clears the
// warning, and a second browser sees the dates after a reload. The dev
// inventory is put back exactly as it was at the end; one quote is made and
// deleted.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // tests that change shared dev data take turns
import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const devLocal = u => /^http:\/\/localhost:\d+\/?$/.test(u) && !/:4000\b/.test(u)
if (!devLocal(API)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (p, init = {}) => (await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })).json()
const api = async (p, init) => (await call(p, init)).data
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

const original = await api('/api/inventory-state')
if (!original || !Array.isArray(original.items) || !original.items.length) { console.error('Dev inventory is empty; nothing to test.'); process.exit(2) }
const keep = ({ items, bundles, locations, stockLevels, transactions }) => ({ items, bundles, locations, stockLevels, transactions })
const saved = JSON.parse(JSON.stringify(keep(original)))
// Start from "never confirmed" so the warning shows (the copy is put back at the end).
const undated = { ...saved, items: saved.items.map(({ priceUpdatedAt, priceImported, ...i }) => i) }
const put = async body => { const cur = await api('/api/inventory-state'); return call('/api/inventory-state', { method: 'PUT', body: JSON.stringify({ ...body, baseVersion: cur.version }) }) }
await put(undated)

const browser = await chromium.launch()
let quoteId = null
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept())

  const q = await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify({ customerName: 'E2E Price Freshness', fenceStyle: "WV-ND 6'x6' Privacy", runs: [60, 90], corners: 1, ends: 2, sections: 0, status: 'DRAFT', finalPrice: 0, date: today }) })
  quoteId = q.id
  await page.goto(`${APP}/quotes?quote=${quoteId}`); await page.waitForSelector('[data-quote-builder]', { timeout: 30000 }); await sleep(1500)
  const warn = page.locator('[data-stale-prices]')
  const parts = await warn.locator('[data-stale-part]').count()
  const head = (await warn.locator('p').first().textContent()) || ''
  check('Quote: soft warning lists parts never confirmed', (await warn.count()) === 1 && parts > 0 && /not confirmed in the last \d+ months?/.test(head), head)
  check('Quote: Save is still there (a warning, not a block)', await page.locator('button:has-text("Save quote"), button:has-text("Update quote")').first().isEnabled())
  if (SHOTS) await warn.screenshot({ path: `${SHOTS}/1-quote-price-warning.png` })
  const partCount = Number(head.match(/^(\d+)/)?.[1] || 0)

  await warn.locator('[data-stale-open]').click(); await page.waitForSelector('[data-only-items]', { timeout: 15000 }); await sleep(800)
  const rows = await page.locator('[data-price-item]').count()
  check('Open in Inventory: just the parts from the quote', /\/inventory\?items=/.test(page.url()) && rows === partCount, `${rows} rows for ${partCount} parts`)
  check('Inventory: imported prices say "Imported, not yet confirmed"', /Imported, not yet confirmed/.test(await page.locator('[data-price-item]').first().textContent()))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-inventory-parts-from-quote.png` })

  // Confirm one price: only its date changes.
  const first = page.locator('[data-price-item]').first()
  const firstId = await first.getAttribute('data-price-item')
  const costBefore = saved.items.find(i => i.id === firstId)?.unitCost
  await first.locator('[data-confirm-price]').click(); await sleep(2500)
  const afterOne = (await api('/api/inventory-state')).items.find(i => i.id === firstId)
  check('Confirm price: saved with today\'s date, price unchanged', afterOne?.priceUpdatedAt === today && afterOne?.priceImported === false && afterOne?.unitCost === costBefore, `${afterOne?.priceUpdatedAt} $${afterOne?.unitCost}`)

  // A second browser sees it after a reload.
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 950 } })
  await ctxB.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const b = await ctxB.newPage()
  await b.goto(`${APP}/inventory?items=${firstId}`); await b.waitForSelector(`[data-price-item="${firstId}"]`, { timeout: 30000 })
  check('Second browser: the confirmed date shows', (await b.locator(`[data-price-item="${firstId}"]`).getAttribute('data-price-age')) === 'fresh')
  await ctxB.close()

  // Change a cost and save: that item gets today's date.
  await page.locator('[data-only-items] button:has-text("Show all items")').click(); await sleep(800)
  await page.locator('[data-price-sort]').selectOption('priceAge'); await sleep(300)
  const row = page.locator('tr', { has: page.locator('[data-price-age="unconfirmed"]') }).first()
  const changedId = await row.locator('[data-price-item]').getAttribute('data-price-item')
  const oldCost = saved.items.find(i => i.id === changedId)?.unitCost ?? 0
  await row.locator('input[type=number]').fill(String(Math.round((oldCost + 1.11) * 100) / 100))
  await page.locator('button:has-text("Save Changes")').first().click(); await sleep(2500)
  const changed = (await api('/api/inventory-state')).items.find(i => i.id === changedId)
  check('Changed cost: "Price last updated" becomes today', changed?.priceUpdatedAt === today && changed?.priceImported === false, `${changed?.priceUpdatedAt}`)

  // Filter to the prices to check, then confirm them all at once.
  await page.locator('[data-price-filter]').selectOption('check'); await sleep(400)
  const toCheck = await page.locator('[data-price-item]').count()
  // A green price borrowed from Black ("From Black" badge) is never confirmed as it is: it waits for its own green
  // price (src/priceAge.ts borrowedPrice, Jonathan's green chain link rule). Those stay; every other shown one is confirmed.
  const borrowedShown = await page.locator('[data-from-black-badge]').count()
  const borrowed = i => !!i.priceFrom && typeof i.priceFrom.cents === 'number' && Math.round(Number(i.unitCost) * 100) === i.priceFrom.cents && !(i.priceUpdatedAt && !i.priceImported)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-inventory-prices-to-check.png` })
  await page.locator('[data-confirm-shown]').click(); await sleep(2500)
  const left = await page.locator('[data-price-item]').count()
  const all = (await api('/api/inventory-state')).items
  const notConfirmed = all.filter(i => !(i.priceUpdatedAt && !i.priceImported))
  check('Bulk "Confirm these prices": every shown item confirmed but the From Black ones', toCheck - borrowedShown > 1 && left === borrowedShown && notConfirmed.every(borrowed) && notConfirmed.length === borrowedShown, `${toCheck - borrowedShown} confirmed, ${left} left, ${borrowedShown} From Black`)
  await page.locator('[data-price-filter]').selectOption('all'); await sleep(300)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-inventory-after-confirm.png` })

  // Back on the quote: no warning now.
  await page.goto(`${APP}/quotes?quote=${quoteId}`); await page.waitForSelector('[data-quote-builder]', { timeout: 30000 }); await sleep(1500)
  check('Quote: no warning once prices are confirmed', (await page.locator('[data-stale-prices]').count()) === 0)
  check('no page errors', errors.length === 0, errors.join(' | '))
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  if (quoteId) await api(`/api/saved-quotes/${quoteId}`, { method: 'DELETE' })
  const r = await put(saved)
  const back = await api('/api/inventory-state')
  check('dev inventory put back as it was', r?.success && JSON.stringify(keep(back)) === JSON.stringify(saved))
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
