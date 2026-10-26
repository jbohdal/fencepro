// Vendor invoices update Inventory prices (Inventory > Invoices).
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//   E2E_SHOTS=<folder> node e2e/invoices.mjs
//
// As the owner on a computer (1440x900):
//   1. upload a text PDF → Needs review (new vendor) → add the vendor → Needs a match
//      → match each item once (box of 100 → each) → Applied at landed cost
//   2. a price well over 20% → Waiting for OK → OK it
//   3. a line that does not add up → Needs review, nothing applied → fixed by tap → Applied
//   4. price history for an item; vendors with totals by month; Undo puts the price back
//   4b. a quotation with no tax line, freight and a fuel charge: estimated tax 7.22% shown and
//       flagged per line, fuel on the bill only; Change match on a quote line; "No tax is right"
//       and back; We ordered this → landed prices with freight and estimated tax, no fuel
// As the owner on a phone (390x844), every screen with no sideways scroll:
//   5. take photos of a paper invoice → saved on the phone → read by the Mac → vendor, match, applied
//   6. no signal: a PDF waits on the phone, then uploads when signal is back
//   7. the same PDF again is refused
// A Salesman: no Invoices tab, and the server answers 403 with no data.
// Screenshots (E2E_SHOTS): dev-invoice-upload-phone.png, dev-invoice-needs-review.png,
// dev-invoice-needs-match.png, dev-invoice-applied.png, dev-invoice-waiting-ok.png,
// dev-invoice-price-history.png, dev-vendors-by-month.png.
// Dev only (port 4001). Test Inventory items, vendors, bills, invoices and the login are removed at the end.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // tests that change shared dev data take turns
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.E2E_SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API) || /:4000(\/|$)/.test(APP)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../portal/tests/fixtures/invoices')
const VENDORS = ['Gulf Coast Fence Supply', 'Ocala Vinyl Wholesale']
const NUMBERS = ['GC-10442', 'GC-10701', 'GC-10600', 'GC-10518', '58213', 'GQ-2201']

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (token, method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let json = {}; try { json = JSON.parse(text) } catch {}
  return { status: r.status, json, text }
}
const owner = (m, p, b) => call(OWNER, m, p, b)
const stamp = Date.now().toString(36).slice(-6)
const ITEMS = [
  { id: `e2e-hog-${stamp}`, name: `E2E Hog Ring ${stamp}`, unitCost: 0.27, category: 'Misc', unitOfMeasure: 'each' },
  { id: `e2e-tb-${stamp}`, name: `E2E Tension Bar ${stamp}`, unitCost: 3.0, category: 'Misc', unitOfMeasure: 'each' },
  { id: `e2e-pipe-${stamp}`, name: `E2E Pipe ${stamp}`, unitCost: 28.13, category: 'Misc', unitOfMeasure: 'each' },
  { id: `e2e-fab-${stamp}`, name: `E2E Fabric ${stamp}`, unitCost: 113.43, category: 'Misc', unitOfMeasure: 'roll' },
]
const cost = async id => Math.round(Number((await owner('GET', '/api/inventory-state')).json.data.items.find(i => i.id === id)?.unitCost) * 100)
const salesEmail = `e2e-sales-inv-${stamp}@example.test`

async function editInventory(fn) {
  for (let k = 0; k < 4; k++) {
    const cur = (await owner('GET', '/api/inventory-state')).json.data
    const r = await owner('PUT', '/api/inventory-state', { ...cur, items: fn(cur.items), baseVersion: cur.version })
    if (r.status === 200) return true
    await sleep(300)
  }
  return false
}
async function editVendors(fn) {
  for (let k = 0; k < 4; k++) {
    const cur = (await owner('GET', '/api/vendor-state')).json.data
    const r = await owner('PUT', '/api/vendor-state', { ...fn(cur), baseVersion: cur.version })
    if (r.status === 200) return true
    await sleep(300)
  }
  return false
}
/** Earlier runs' (and this run's) test invoices, vendors and bills. */
async function cleanup() {
  const list = (await owner('GET', '/api/vendor-invoices')).json.data ?? []
  for (const i of list.filter(x => NUMBERS.includes(x.invoiceNumber) || VENDORS.some(v => (x.vendorName || '').toLowerCase() === v.toLowerCase()) || x.status === 'refused' && /GC-1|58213/.test(x.message))) {
    if (i.status === 'applied' || i.status === 'needs_match') await owner('POST', `/api/vendor-invoices/${i.id}/undo`)
    await owner('DELETE', `/api/vendor-invoices/${i.id}`)
  }
  await editVendors(v => {
    const ids = new Set(v.vendors.filter(x => VENDORS.some(n => n.toLowerCase() === String(x.name).toLowerCase())).map(x => x.id))
    return { vendors: v.vendors.filter(x => !ids.has(x.id)), bills: v.bills.filter(b => !ids.has(b.vendorId)), payments: v.payments }
  })
  await editInventory(items => items.filter(i => !String(i.id).startsWith('e2e-hog-') && !String(i.id).startsWith('e2e-tb-') && !String(i.id).startsWith('e2e-pipe-') && !String(i.id).startsWith('e2e-fab-')))
}

const browser = await chromium.launch()
const errors = []
async function signedIn(token, refresh, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1 })
  await ctx.addInitScript(([t, r]) => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', r || 'e2e') }, [token, refresh])
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))
  return { ctx, page }
}
const openInvoices = async page => {
  await page.goto(`${APP}/inventory?tab=invoices`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-invoices-tab]', { timeout: 30000 })
  await sleep(800)
}
const statusOf = async number => ((await owner('GET', '/api/vendor-invoices')).json.data ?? []).find(i => i.invoiceNumber === number)
async function waitFor(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(1000) } return null }
const noSideways = async page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const openRow = async (page, number) => { await page.locator(`[data-invoice-row="${number}"]`).first().click(); await page.waitForSelector('[data-invoice-detail]', { timeout: 15000 }); await sleep(1200) }
async function matchIn(page, code, itemName, preset) {
  const line = page.locator(`[data-line^="${code}"]`).first()
  await line.locator('[data-match-line]').click()
  await line.locator('[data-match-search]').fill(itemName)
  await line.locator(`button:has-text("${itemName}")`).first().click()
  if (preset) await line.locator(`[data-unit-preset="${preset}"]`).click()
  await line.locator('[data-save-match]').click()
  await sleep(1500)
}

try {
  await cleanup()
  check('setup: test Inventory items added', await editInventory(items => [...items, ...ITEMS]))

  // ── Owner on a computer ──
  const d = await signedIn(OWNER, 'e2e', { width: 1440, height: 900 })
  const page = d.page
  await openInvoices(page)
  check('Inventory has an Invoices tab with Upload invoice', await page.locator('[data-upload-pdf]').isVisible())

  // 1. Text PDF
  await page.setInputFiles('[data-pdf-input]', path.join(FIX, 'text.pdf'))
  const text = await waitFor(async () => { const i = await statusOf('GC-10442'); return i && i.status !== 'reading' && i.status !== 'receiving' ? i : null })
  check('text PDF read on the Mac: Needs review because the vendor is new', text?.status === 'needs_review', text?.status)
  await sleep(1500)
  await openRow(page, 'GC-10442')
  await page.locator('[data-add-vendor]').click()
  await sleep(1500)
  check('vendor added once: the invoice adds up and waits for matches', await page.locator('[data-status="needs_match"]').isVisible())
  await page.locator('[data-back]').click(); await sleep(800)
  await page.locator('[data-invoice-view="match"]').click(); await sleep(1500)
  check('Needs a match lists the 4 new vendor items', await page.locator('[data-needs-match-list] > li', { hasText: '#GC-10442' }).count() === 4)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-invoice-needs-match.png`, fullPage: true })
  await page.locator('[data-invoice-view="invoices"]').click(); await sleep(800)
  await openRow(page, 'GC-10442')
  await matchIn(page, 'HR-100', ITEMS[0].name, '1 BX = 100 each')
  check('hog rings: $100 + $12 share of tax and freight for 400 = $0.28 each', await cost(ITEMS[0].id) === 28, `${await cost(ITEMS[0].id)}`)
  await matchIn(page, 'TB-48G', ITEMS[1].name)
  await matchIn(page, 'PP-258', ITEMS[2].name)
  await matchIn(page, 'FAB-48K', ITEMS[3].name)
  await sleep(1000)
  check('all matched: Applied', await page.locator('[data-status="applied"]').isVisible())
  check('landed costs in Inventory: $3.36, $31.36, $123.20', await cost(ITEMS[1].id) === 336 && await cost(ITEMS[2].id) === 3136 && await cost(ITEMS[3].id) === 12320)
  const tb = (await owner('GET', '/api/inventory-state')).json.data.items.find(i => i.id === ITEMS[1].id)
  check('price confirmed with the invoice date', tb.priceUpdatedAt === '2026-10-02' && tb.priceImported === false, tb.priceUpdatedAt)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-invoice-applied.png`, fullPage: true })
  await page.locator('[data-back]').click(); await sleep(500)

  // 2. Over 20%
  await page.setInputFiles('[data-pdf-input]', path.join(FIX, 'jump.pdf'))
  const jump = await waitFor(async () => { const i = await statusOf('GC-10701'); return i && i.status === 'applied' ? i : null })
  check('jump invoice: applied, one price waiting for OK', jump?.counts.waitingOk === 1, JSON.stringify(jump?.counts))
  check('the waiting price did not change; the rest did', await cost(ITEMS[1].id) === 336 && await cost(ITEMS[0].id) === 25)
  await page.locator('[data-invoice-view="waiting"]').click(); await sleep(1500)
  check('Waiting for OK shows $3.36 → $4.40 (+31%)', /\$3\.36[\s\S]*\$4\.40[\s\S]*\+31\.0%/.test(await page.locator('[data-waiting-list]').innerText()))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-invoice-waiting-ok.png`, fullPage: true })
  await page.locator('[data-waiting-list] [data-ok]').first().click(); await sleep(1500)
  check('OK applies it', await cost(ITEMS[1].id) === 440)

  // 3. A line that does not add up
  await page.locator('[data-invoice-view="invoices"]').click(); await sleep(500)
  await page.setInputFiles('[data-pdf-input]', path.join(FIX, 'bad-line.pdf'))
  const bad = await waitFor(async () => { const i = await statusOf('GC-10600'); return i && i.status !== 'reading' && i.status !== 'receiving' ? i : null })
  check('a line that does not add up: Needs review', bad?.status === 'needs_review')
  check('nothing applied from it', await cost(ITEMS[1].id) === 440 && await cost(ITEMS[0].id) === 25)
  await sleep(1200)
  await openRow(page, 'GC-10600')
  check('the problem line is red, next to the page picture with it highlighted', await page.locator('[data-line^="TB-48G"][data-bad="1"]').isVisible() && await page.locator('[data-page-image] img').isVisible() && await page.locator('[data-box].ring-red-500').count() >= 1)
  await page.locator('[data-line^="TB-48G"] > button').first().click(); await sleep(500)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-invoice-needs-review.png`, fullPage: true })
  await page.locator('[data-line-editor] [data-edit="price"]').fill('3.50')
  await page.locator('[data-line-editor] [data-save-line]').click(); await sleep(2000)
  check('fixed by tap: Applied', await page.locator('[data-status="applied"]').isVisible())
  check('tension bars now (210 + 14.70) / 60 = $3.75', await cost(ITEMS[1].id) === 375)

  // 4. Price history, vendors by month, Undo
  await page.locator('[data-back]').click(); await sleep(500)
  await page.locator('[data-invoice-view="history"]').click(); await sleep(800)
  await page.locator('[data-history-search]').fill(ITEMS[1].name)
  await page.locator(`[data-price-history] button:has-text("${ITEMS[1].name}")`).first().click(); await sleep(1500)
  const hist = await page.locator('[data-price-history]').innerText()
  check('price history for tension bars: $3.36, $4.40, $3.75 with vendor and invoice', /\$3\.75/.test(hist) && /\$4\.40/.test(hist) && /\$3\.36/.test(hist) && /GC-10600/.test(hist))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-invoice-price-history.png`, fullPage: true })
  await page.locator('[data-invoice-view="vendors"]').click(); await sleep(1500)
  check('vendors with totals by month: Gulf Coast in October', /Gulf Coast Fence Supply[\s\S]*\$1,991\.70/i.test(await page.locator('[data-vendors-by-month]').innerText()))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-vendors-by-month.png`, fullPage: true })
  await page.locator('[data-invoice-view="invoices"]').click(); await sleep(500)
  await openRow(page, 'GC-10600')
  await page.locator('[data-undo]').click(); await sleep(2000)
  check('Undo puts the price back ($4.40)', await cost(ITEMS[1].id) === 440 && await page.locator('[data-status="undone"]').isVisible())

  // 4b. Jonathan's rules (Oct 26): a quotation with no tax line, $10 freight and a $5 fuel charge.
  await page.locator('[data-back]').click(); await sleep(500)
  await page.setInputFiles('[data-pdf-input]', path.join(FIX, 'no-tax.pdf'))
  const nt = await waitFor(async () => { const i = await statusOf('GQ-2201'); return i && i.status !== 'reading' && i.status !== 'receiving' ? i : null })
  check('no tax line: no waiting for an OK, a vendor quote with estimated tax 7.22%', nt?.status === 'quote' && nt?.estTaxBp === 722 && nt?.estTaxCents === 563, `${nt?.status} ${nt?.estTaxBp} ${nt?.estTaxCents}`)
  await sleep(1200)
  await openRow(page, 'GQ-2201')
  check('the quote says estimated tax, and that it is not on the bill', /Estimated tax\.[\s\S]*7\.22%[\s\S]*\$5\.63[\s\S]*not added to the vendor bill/.test(await page.locator('[data-est-tax]').innerText()))
  check('each line is flagged Estimated tax', await page.locator('[data-line-est-tax]').count() === 2)
  const totals = await page.locator('[data-totals]').innerText()
  check('totals: tax none printed, fuel on the bill only, estimated tax shown', /none printed/.test(totals) && /Fuel Charge \(bill only, not in item prices\)/.test(totals) && /Estimated tax 7\.22%[\s\S]*\$5\.63/.test(totals))
  // Tension bars: $30 + $3.85 freight + $2.17 estimated tax (no fuel) = $36.02 for 10 → $3.60.
  check('tension bars would be $3.60 (freight and estimated tax, no fuel)', /landed \$3\.60 each/.test(await page.locator('[data-line^="TB-48G"]').innerText()))
  // Change match on a quote line, then back.
  const tbLine = page.locator('[data-line^="TB-48G"]').first()
  // The picker (re-check, Oct 26): the item matched now is among its suggestions; Cancel and a tap on the line close it.
  await tbLine.locator('[data-change-match]').click(); await sleep(1200)
  check('Change match: the current match is suggested ("matched now")', await tbLine.locator(`[data-suggestion="${ITEMS[1].id}"]`).count() === 1 && /matched now/.test(await tbLine.locator(`[data-suggestion="${ITEMS[1].id}"]`).innerText()))
  await tbLine.locator('[data-match-search]').fill(`bar ${stamp} e2e`)
  check('search: every word in any order ("bar <id> e2e" finds the tension bars)', await tbLine.locator(`button:has-text("${ITEMS[1].name}")`).count() >= 1)
  await tbLine.locator('[data-cancel-match]').click(); await sleep(400)
  check('Cancel closes the picker', await tbLine.locator('[data-matcher]').count() === 0 && await tbLine.locator('[data-change-match]').isVisible())
  await tbLine.locator('[data-change-match]').click(); await sleep(600)
  await tbLine.locator('button.w-full.text-left').first().click(); await sleep(400)
  check('a tap on the line closes the picker too', await tbLine.locator('[data-matcher]').count() === 0)
  await tbLine.locator('[data-change-match]').click(); await sleep(800)
  await tbLine.locator('[data-match-search]').fill(ITEMS[2].name)
  await tbLine.locator(`button:has-text("${ITEMS[2].name}")`).first().click()
  await tbLine.locator('[data-save-match]').click(); await sleep(1500)
  check('Change match on a quote line: now the pipe', new RegExp(`→ ${ITEMS[2].name}`).test(await page.locator('[data-line^="TB-48G"]').innerText()))
  await page.locator('[data-line^="TB-48G"] [data-change-match]').click(); await sleep(800)
  await page.locator('[data-line^="TB-48G"] [data-match-search]').fill(ITEMS[1].name)
  await page.locator(`[data-line^="TB-48G"] button:has-text("${ITEMS[1].name}")`).first().click()
  await page.locator('[data-line^="TB-48G"] [data-save-match]').click(); await sleep(1500)
  check('and back to tension bars', new RegExp(`→ ${ITEMS[1].name}`).test(await page.locator('[data-line^="TB-48G"]').innerText()))
  // No tax is right takes it off; Add the estimated tax puts it back.
  await page.locator('[data-tax-ok]').click(); await sleep(1500)
  check('"No tax is right" takes the estimated tax off', /no tax is right/.test(await page.locator('[data-est-tax]').innerText()) && await page.locator('[data-line-est-tax]').count() === 0)
  await page.locator('[data-tax-ok]').click(); await sleep(1500)
  check('"Add the estimated tax" puts it back', await page.locator('[data-line-est-tax]').count() === 2)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-invoice-estimated-tax.png`, fullPage: true })
  await page.locator('[data-we-ordered]').click(); await sleep(2500)
  check('We ordered this: applied; tension bars $4.40 → $3.60, hog rings $0.25 → $0.29', await cost(ITEMS[1].id) === 360 && await cost(ITEMS[0].id) === 29, `${await cost(ITEMS[1].id)} ${await cost(ITEMS[0].id)}`)
  const ntBill = (await owner('GET', '/api/vendor-state')).json.data.bills.find(b => b.billNumber === 'GQ-2201')
  check('the bill is the printed $93.00 with the $5 fuel; the estimated tax is noted, not billed', ntBill?.totalCents === 9300 && ntBill?.feesCents === 500 && /Fuel Charge \$5\.00 \(on this bill only/.test(ntBill?.notes) && /estimated tax 7\.22% \(\$5\.63\)/.test(ntBill?.notes), ntBill?.notes)

  // 4c. Undo the order, then order it again (re-check, Oct 26): one bill, back and forth; Vendors
  //     points to the document instead of a Restore; Accounts Payable open in another tab follows.
  const gqBills = async () => ((await owner('GET', '/api/vendor-state')).json.data.bills ?? []).filter(b => b.billNumber === 'GQ-2201')
  await page.locator('[data-undo]').click(); await sleep(2500)
  check('Undo the order: Undone, its bill voided, prices back', await page.locator('[data-status="undone"]').isVisible() && (await gqBills()).map(b => b.status).join() === 'void' && await cost(ITEMS[1].id) === 440)
  check('the undone order offers We ordered this again', await page.locator('[data-order-again] [data-we-ordered]').isVisible() && /tap We ordered this here/.test(await page.locator('[data-message]').innerText()))
  const p2 = await d.ctx.newPage()
  p2.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  await p2.goto(`${APP}/vendors`, { waitUntil: 'domcontentloaded' }); await sleep(3000)
  const gqVendor = (await gqBills())[0]?.vendorName || VENDORS[0]
  await p2.locator(`button:has-text("${gqVendor}")`).first().click().catch(() => {}); await sleep(1000)
  check('Vendors: the voided bill has no Restore; it points to its document', await p2.locator('[data-order-undone-bill="GQ-2201"]').isVisible() && await p2.locator('[data-restore-bill="GQ-2201"]').count() === 0)
  await p2.locator('[data-open-document="GQ-2201"]').click()
  check('its document opens from Vendors', await p2.waitForSelector('[data-invoice-detail="GQ-2201"]', { timeout: 15000 }).then(() => true).catch(() => false))
  await p2.goto(`${APP}/accounts-payable`, { waitUntil: 'domcontentloaded' }); await sleep(3000)
  const apBefore = await p2.locator('body').innerText()
  await page.locator('[data-order-again] [data-we-ordered]').click(); await sleep(2500)
  const back = await gqBills()
  check('We ordered this again: prices back, the same bill back in Accounts Payable (one bill)', back.length === 1 && back[0].status === 'received' && back[0].totalCents === 9300 && await cost(ITEMS[1].id) === 360, JSON.stringify(back.map(b => [b.id, b.status])))
  check('Accounts Payable open in the other tab shows it without a reload', !!await waitFor(async () => (await p2.locator('body').innerText()) !== apBefore, 30000))
  await p2.close()
  // Remove after Undo: back to the list, never a read of the removed document.
  await page.locator('[data-undo]').click(); await sleep(2500)
  const gone404 = []
  page.on('response', r => { if (r.status() === 404 && /\/api\/vendor-invoices\/[\w-]+$/.test(r.url())) gone404.push(r.url()) })
  await page.locator('[data-remove]').click(); await sleep(2500)
  check('Remove: back to the list, no request for the removed document', await page.locator('[data-invoice-list], [data-invoices-tab]').first().isVisible() && gone404.length === 0 && (await gqBills()).length === 0, gone404.join(' '))
  await d.ctx.close()

  // ── Owner on a phone ──
  const p = await signedIn(OWNER, 'e2e', { width: 390, height: 844 })
  const ph = p.page
  await openInvoices(ph)
  check('phone: no sideways scroll on Invoices', await noSideways(ph))
  await ph.setInputFiles('[data-photos-input]', path.join(FIX, 'photo.jpg'))
  await sleep(500)
  check('phone: the photo waits as page 1 of one invoice', await ph.locator('[data-pages-tray]').isVisible())
  if (SHOTS) await ph.screenshot({ path: `${SHOTS}/dev-invoice-upload-phone.png`, fullPage: true })
  await ph.locator('[data-send-pages]').click()
  const photo = await waitFor(async () => { const i = await statusOf('58213'); return i && i.status !== 'reading' && i.status !== 'receiving' ? i : null }, 60000)
  check('phone photo read by the Mac (Vision): Needs review for the new vendor only', photo?.status === 'needs_review' && photo?.engine === 'vision', `${photo?.status} ${photo?.engine}`)
  await sleep(2500)
  await openRow(ph, '58213')
  check('phone: no sideways scroll on an invoice', await noSideways(ph))
  await ph.locator('[data-new-vendor-name]').fill('Ocala Vinyl Wholesale')
  await ph.locator('[data-add-vendor]').click(); await sleep(1500)
  for (let k = 0; k < 3; k++) {
    const left = await ph.locator('[data-match-line]').count()
    if (!left) break
    await ph.locator('[data-match-line]').first().click()
    await ph.locator('[data-not-inventory]').first().click()
    await waitFor(async () => (await ph.locator('[data-match-line]').count()) < left && !(await ph.locator('[data-matcher]').count()), 15000)
  }
  await waitFor(async () => ph.locator('[data-status="applied"]').isVisible(), 10000)
  check('phone: matched (not Inventory items) and applied', await ph.locator('[data-status="applied"]').isVisible())
  await ph.locator('[data-back]').click(); await sleep(800)
  for (const v of ['match', 'waiting', 'history', 'vendors']) {
    await ph.locator(`[data-invoice-view="${v}"]`).click(); await sleep(1200)
    check(`phone: no sideways scroll on ${v}`, await noSideways(ph))
  }
  await ph.locator('[data-invoice-view="invoices"]').click(); await sleep(500)

  // 6. No signal: waits on the phone, then goes.
  await p.ctx.setOffline(true)
  await ph.setInputFiles('[data-pdf-input]', path.join(FIX, 'two-page.pdf'))
  await sleep(1500)
  check('no signal: the PDF is saved on the phone, waiting', /1 file saved on this device/.test(await ph.locator('[data-on-phone]').innerText().catch(() => '')))
  await p.ctx.setOffline(false)
  await ph.evaluate(() => window.dispatchEvent(new Event('online')))
  const two = await waitFor(async () => { const i = await statusOf('GC-10518'); return i && i.status !== 'reading' && i.status !== 'receiving' ? i : null }, 60000)
  check('signal back: uploaded and read (two pages)', !!two && two.pageCount === 1 && two.status !== 'failed', two?.status)

  // 7. The same file again
  await ph.setInputFiles('[data-pdf-input]', path.join(FIX, 'text.pdf'))
  const refused = await waitFor(async () => ((await owner('GET', '/api/vendor-invoices')).json.data ?? []).find(i => i.status === 'refused' && /already uploaded/.test(i.message)))
  check('the same invoice again is refused', !!refused, refused?.message)
  await p.ctx.close()

  // ── A Salesman ──
  const inv = await owner('POST', '/api/crm-auth/invite', { firstName: 'E2E', lastName: `Sales ${stamp}`, email: salesEmail, role: 'sales_rep' })
  const link = new URL(inv.json.data.inviteUrl)
  const acc = await call('', 'POST', '/api/crm-auth/accept-invite', { token: link.searchParams.get('token'), email: salesEmail, password: `Ch-${crypto.randomBytes(9).toString('base64url')}` })
  const st = acc.json.data?.accessToken
  const answers = await Promise.all(['/api/vendor-invoices', '/api/vendor-invoices/waiting', '/api/vendor-invoices/history', '/api/vendor-invoices/vendors-by-month', `/api/vendor-invoices/${text?.id}`].map(u => call(st, 'GET', u)))
  check('salesman: 403 and no data from every invoice route', answers.every(a => a.status === 403 && a.json.data === undefined && !/GC-10442|Gulf Coast/.test(a.text)))
  const up = await call(st, 'POST', '/api/media/uploads', { clientId: crypto.randomUUID(), size: 100, meta: { kind: 'invoice', mime: 'application/pdf', invoiceBatch: crypto.randomUUID(), invoiceSeq: 0, invoicePages: 1 } })
  check('salesman: cannot upload an invoice (403)', up.status === 403)
  const s = await signedIn(st, acc.json.data?.refreshToken, { width: 390, height: 844 })
  await s.page.goto(`${APP}/inventory?tab=invoices`, { waitUntil: 'domcontentloaded' }); await sleep(4000)
  check('salesman: no Invoices tab, nothing shown', !(await s.page.locator('[data-inventory-tab="invoices"]').count()) && !(await s.page.locator('[data-invoices-tab]').count()))
  await s.ctx.close()

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (err) {
  check('ran to the end', false, String(err?.stack || err).slice(0, 600))
} finally {
  await cleanup().catch(e => console.error('cleanup:', e))
  const users = (await owner('GET', '/api/crm-auth/users')).json.data ?? []
  for (const u of users.filter(x => x.email === salesEmail)) await owner('DELETE', `/api/crm-auth/users/${u.id}`).catch(() => {})
  await browser.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
