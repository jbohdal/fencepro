// Broken list #58 (money): an app already open keeps the prices it loaded.
//
//   APP_URL=http://localhost:<worktree server> E2E_ACCESS_TOKEN_FILE=<dev owner token> E2E_STAFF_COOKIE=<dev owner cookie> \
//     [SHOTS=<folder>] node e2e/stale-prices.mjs
//
// Two browsers: the owner's (here, his saves through the API, as the Price
// List and Inventory screens make them) and an app already open on a phone
// (WebKit, iPhone size) with a draft quote in the quote builder.
//
//   1. With the quote open, the owner raises the cost of a part on its pull
//      sheet. Without a reload, Save on the phone does not save the old price:
//      it says "Prices changed since you opened this quote. It is now $X (was
//      $Y)." and saves only after "Save at $X". The server has $X; the page
//      was never reloaded.
//   2. The quote opened again (a fresh tab) shows the saved price, no line.
//   3. With the quote open again, the owner puts the price back. The open
//      builder picks it up by itself (focus / its 30 second check): the price
//      on screen moves back and the line says so, before anything is tapped.
//   4. A save sent on the old stamp straight to the server: 409 PRICES_CHANGED.
//
// Shared dev data (Inventory) is changed, so it takes turns (sharedLock.mjs)
// and puts the part's cost back exactly as it was. Its quote and customer are
// removed (hard deletes on ezbiz_dev only).
import './devOnly.mjs'
import './sharedLock.mjs'
import { webkit } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const TOKEN = process.env.E2E_ACCESS_TOKEN || (process.env.E2E_ACCESS_TOKEN_FILE ? fs.readFileSync(process.env.E2E_ACCESS_TOKEN_FILE, 'utf8').trim() : '')
const COOKIE = process.env.E2E_STAFF_COOKIE ? (fs.existsSync(process.env.E2E_STAFF_COOKIE) ? fs.readFileSync(process.env.E2E_STAFF_COOKIE, 'utf8').trim() : process.env.E2E_STAFF_COOKIE) : ''
const SHOTS = process.env.SHOTS || ''
if (!TOKEN || !COOKIE) { console.error('Set E2E_ACCESS_TOKEN(_FILE) and E2E_STAFF_COOKIE (scripts/dev-session-token.ts) for the dev owner.'); process.exit(2) }
const envFile = new URL('../../portal/.env', import.meta.url)
if (!/\/ezbiz_dev(\?|")/.test(fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL=.*$/m)?.[0] ?? '')) { console.error('Refusing to run: apps/portal/.env does not name ezbiz_dev.'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'X-Staff-Request': '1', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
async function until(fn, ms = 20000, every = 400) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `stale-${name}`) }).catch(() => {}) }
const money = cents => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`

const tag = Date.now().toString(36).slice(-5)
const NAME = `E2E Stale Prices ${tag}`
const contactId = crypto.randomUUID(), quoteId = crypto.randomUUID()
let part = null, originalCost = null

/** The owner saves a part's cost (Inventory), as the app does: on the record's current version. */
async function setCost(id, unitCost) {
  for (let i = 0; i < 5; i++) {
    const inv = (await call('GET', '/api/inventory-state')).json.data
    const items = inv.items.map(x => (x.id === id ? { ...x, unitCost } : x))
    const r = await call('PUT', '/api/inventory-state', { items, bundles: inv.bundles, locations: inv.locations, stockLevels: inv.stockLevels, transactions: inv.transactions, baseVersion: inv.version })
    if (r.status < 300) return true
    await sleep(500)
  }
  return false
}

const browser = await webkit.launch()
try {
  // ── A draft to work on: a copy of a recent quote priced from its parts ──
  const all = (await call('GET', '/api/saved-quotes')).json.data ?? []
  const template = all.filter(q => !/^E2E/i.test(q.customerName) && q.status !== 'SOLD' && !q.work && q.runs?.length && Array.isArray(q.pullSheet) && q.pullSheet.length >= 6 && q.totalCOGS > 0 && q.finalPrice > 1500
    && !(q.pricing?.finalPrice > 0) && (q.pricing?.priceMethod ?? 'cost_factor') === 'cost_factor')
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
  check('a priced quote to copy', !!template, template ? `${template.fenceStyle}, ${template.runs.length} runs` : 'none')
  if (!template) throw new Error('no template quote')
  const inv0 = (await call('GET', '/api/inventory-state')).json.data
  // The part with the most pieces on its pull sheet that Inventory prices (not a piece price).
  const byName = new Map(inv0.items.map(i => [String(i.name).toLowerCase().replace(/\s+/g, ' ').trim(), i]))
  const line = [...template.pullSheet].filter(l => l.qty > 0 && l.costSource !== 'jobLot' && l.costSource !== 'wood' && byName.get(String(l.item).toLowerCase().replace(/\s+/g, ' ').trim())?.unitCost > 0).sort((a, b) => b.qty - a.qty)[0]
  part = line ? byName.get(String(line.item).toLowerCase().replace(/\s+/g, ' ').trim()) : null
  originalCost = part?.unitCost ?? null
  check('a part on its pull sheet that Inventory prices', !!part, part ? `${part.name} × ${line.qty} at $${originalCost}` : 'none')
  if (!part) throw new Error('no part')

  const c = await call('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E', lastName: `Stale Prices ${tag}`, phone: '3525550158', email: 'e2e-stale-prices@example.invalid', leadSource: 'Other' })
  const priced = ['fenceStyle', 'runs', 'runRails', 'corners', 'ends', 'walkGates', 'dblGates', 'tearOutSections', 'tearOutGates', 'adjLaborHrs', 'hasSalesman', 'priceAdjust', 'sections', 'materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'finalPrice', 'gmPct', 'pullSheet']
  const { roundingCents, costFactor, overheadPct, ...pricing } = template.pricing ?? {}
  void roundingCents; void costFactor; void overheadPct
  const d = await call('POST', '/api/saved-quotes', {
    id: quoteId, ...Object.fromEntries(priced.map(k => [k, template[k]])), pricing, layout: { yard: null, runSections: template.layout?.runSections ?? [] },
    crmContactId: contactId, customerName: NAME, customerPhone: '3525550158', customerEmail: 'e2e-stale-prices@example.invalid', customerAddress: '58 Stale Price Rd, Ocala, FL 34470', leadSource: 'Other', salesRep: 'E2E', status: 'DRAFT',
  })
  check('set up: a new Draft quote', c.status < 300 && d.status < 300, `${c.status} ${d.status}`)

  // ── The app already open, on a phone ──
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const u = new URL(API)
  await ctx.addCookies([{ name: 'ezbiz_staff', value: COOKIE, domain: u.hostname, path: '/api', httpOnly: true, secure: false, sameSite: 'Strict' }])
  const errors = [], quoteSaves = []
  let page = null
  /** A new tab with the app (as opening the quote from a link: the app loads fresh). */
  const open = async () => {
    if (page) await page.close().catch(() => {})
    page = await ctx.newPage()
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
    page.on('dialog', dl => dl.accept().catch(() => {}))
    page.on('response', r => { if (/\/api\/saved-quotes(\/|$)/.test(new URL(r.url()).pathname) && r.request().method() !== 'GET') quoteSaves.push(`${r.request().method()} ${r.status()}`) })
    await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
    await page.goto(`${APP}/?quote=${quoteId}`)
    await page.waitForSelector('[data-quote-builder] [data-bar-price]', { timeout: 40000 })
    await sleep(2000)
  }
  const barCents = async () => Number(await page.locator('[data-bar-price]').first().getAttribute('data-builder-cents'))
  await open()
  await page.evaluate(() => { window.__sameVisit = 'yes' })
  const before = await barCents()
  check('the quote builder is open with a price', before > 0, money(before))
  await shot(page, '1-open.png')

  // ── 1. The owner raises the part's cost; the open app saves ──
  const raised = Math.round((originalCost + 3) * 100) / 100
  check('the owner raises the part\'s cost (Inventory save)', await setCost(part.id, raised), `${part.name}: $${originalCost} → $${raised}`)
  await page.locator('[data-save-open]').first().click()
  await page.waitForSelector('[data-save-submit]', { timeout: 10000 })
  await page.locator('[data-save-submit]').click()
  const dialog = await until(async () => (await page.locator('[data-price-recheck="confirm"]').count()) ? page.locator('[data-price-recheck="confirm"]') : null, 20000)
  const nowCents = await barCents()
  const lineText = dialog ? (await dialog.locator('[data-price-recheck-line]').innerText()).trim() : ''
  check('Save does not save the old price: the new price is shown to confirm', !!dialog && nowCents > before
    && lineText === `Prices changed since you opened this quote. It is now ${money(nowCents)} (was ${money(before)}).`, lineText || 'no dialog')
  const savedEarly = (await call('GET', `/api/saved-quotes/${quoteId}`)).json.data
  check('nothing saved before the confirm', Math.round(savedEarly.finalPrice * 100) === Math.round(template.finalPrice * 100), `${savedEarly.finalPrice}`)
  await shot(page, '2-confirm.png')
  if (dialog) await dialog.locator('[data-price-recheck-save]').click()
  const saved = await until(async () => { const q = (await call('GET', `/api/saved-quotes/${quoteId}`)).json.data; return Math.round(q.finalPrice * 100) === nowCents ? q : null }, 30000)
  check('confirmed: the server has the new price', !!saved, saved ? money(Math.round(saved.finalPrice * 100)) : 'not saved')
  check('no save was refused on the way (no 409)', !quoteSaves.some(s => / 409$/.test(s)), quoteSaves.join(', '))
  check('the page was never reloaded', (await page.evaluate(() => window.__sameVisit).catch(() => null)) === 'yes')

  // ── 2. Opened again (a new tab): the saved price, no line ──
  await open()
  check('opened again: the saved price, no "prices changed" line', (await barCents()) === nowCents && (await page.locator('[data-quote-price-changed-banner]').count()) === 0, money(await barCents()))

  // ── 3. The owner puts the price back; the open builder follows by itself ──
  await page.evaluate(() => { window.__sameVisit = 'yes' })
  check('the owner puts the cost back', await setCost(part.id, originalCost))
  // The builder checks every 30 seconds; a focus check comes sooner on a real phone (liveRefresh.ts).
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const followed = await until(async () => ((await barCents()) === before ? true : null), 45000, 1000)
  const banner = await page.locator('[data-quote-price-changed-banner]').innerText().catch(() => '')
  check('without a reload or a tap, the open quote shows the price as it is now', !!followed, money(await barCents()))
  check('...and says so', /^Prices changed (while this quote was open|since this quote was saved)\. It is now /.test(banner.trim()), banner.trim())
  check('the page was still never reloaded', (await page.evaluate(() => window.__sameVisit).catch(() => null)) === 'yes')
  await shot(page, '3-followed.png')

  // ── 4. The server's own check: a save on an old stamp ──
  const st = (await call('GET', '/api/quote-pricing/stamp')).json.data
  const stale = await call('PATCH', `/api/saved-quotes/${quoteId}`, { runs: [...(template.runs ?? []), 10], finalPrice: saved?.finalPrice + 400, pricingStamp: 'old.old.old' })
  check('a save on an old stamp is refused by the server (409 PRICES_CHANGED), nothing saved', stale.status === 409 && stale.json.code === 'PRICES_CHANGED' && stale.json.stamp === st?.stamp, `${stale.status} ${stale.json.code}`)
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()
} catch (e) {
  check('ran to the end', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  await browser.close().catch(() => {})
  try {
    if (part && originalCost != null) {
      const now = (await call('GET', '/api/inventory-state')).json.data.items.find(i => i.id === part.id)
      if (now?.unitCost !== originalCost) await setCost(part.id, originalCost)
      const back = (await call('GET', '/api/inventory-state')).json.data.items.find(i => i.id === part.id)
      check('the part\'s cost is back as it was', back?.unitCost === originalCost, `${back?.unitCost}`)
    }
    sql(`BEGIN;
      DELETE FROM "AutomationEvent" WHERE "entityId" IN ('${quoteId}', '${contactId}');
      DELETE FROM "SavedQuote" WHERE id = '${quoteId}';
      DELETE FROM "CrmAuditLog" WHERE "entityId" IN ('${quoteId}', '${contactId}');
      COMMIT;`)
    const pl = (await call('GET', '/api/pipeline')).json
    const mine = (pl?.data?.leads ?? []).filter(l => l.customerId === contactId || l.quoteId === quoteId).map(l => l.id)
    if (mine.length) await call('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pl.data.version })
    await call('DELETE', `/api/crm-contacts/${contactId}`)
    sql(`DELETE FROM "CrmContact" WHERE id = '${contactId}'`)
    const left = Number(sql(`SELECT (SELECT count(*) FROM "SavedQuote" WHERE id = '${quoteId}') + (SELECT count(*) FROM "CrmContact" WHERE id = '${contactId}')`))
    check('cleaned up', left === 0, `${left} rows left`)
  } catch (e) { check('cleaned up', false, String(e).split('\n')[0]) }
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed} of ${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
}
