// Material kits in a browser on the dev copy.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev token> SHOTS=<folder> node e2e/material-kits.mjs
//
// Inventory > Material Kits shows each style's kits with costs; changing a
// kit lists the open quotes it would change (and Discard puts it back);
// duplicate and rename change no quote; a saved change reaches a second
// browser after a reload and the quote builder; a 6'x8' gate leaf is built
// from 6 ft parts. Makes one quote and deletes it; the saved kits are put back.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // tests that change shared dev data take turns
import fs from 'fs'
import os from 'os'
import path from 'path'
import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
if (!/localhost:4001/.test(API)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (p, init = {}) => (await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })).json()
const api = async (p, init) => (await call(p, init)).data
const STYLE = "WV-ND 6'x8' Privacy"
const PICKET = '*Vinyl, White, Picket, 62-1/4"'

const putKits = async kits => { const cur = await api('/api/inventory-state'); const { items, bundles, locations, stockLevels, transactions } = cur; return call('/api/inventory-state', { method: 'PUT', body: JSON.stringify({ items, bundles, locations, stockLevels, transactions, kits, baseVersion: cur.version }) }) }
// The saved kits are emptied for the test and put back after. A run that dies part way (the dev
// server restarting) once left the dev kits empty, so the kits are also written to a file first, and
// a later run puts a left-over file back before it starts (Oct 20, 2026).
const KEPT_FILE = path.join(os.tmpdir(), 'ezbiz-e2e-material-kits-kept.json')
if (fs.existsSync(KEPT_FILE)) {
  const left = JSON.parse(fs.readFileSync(KEPT_FILE, 'utf8'))
  const r = await putKits(left)
  if (!r?.success) { console.error(`A previous run left the dev kits emptied and they could not be put back yet. Kits are in ${KEPT_FILE}.`); process.exit(2) }
  console.log(`(put back ${left.length} saved kits left emptied by an earlier run)`)
  fs.rmSync(KEPT_FILE)
}
const before = await api('/api/inventory-state')
const keptKits = JSON.parse(JSON.stringify(before.kits ?? []))
fs.writeFileSync(KEPT_FILE, JSON.stringify(keptKits))
await putKits([])

const browser = await chromium.launch()
let quoteId = null
const session = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  return ctx
}
const openKits = async page => {
  await page.goto(`${APP}/inventory`); await page.waitForSelector('[data-page-scroll]'); await sleep(1200)
  await page.locator('button:has-text("Material Kits")').click(); await page.waitForSelector('[data-material-kits]')
  await page.locator('[data-kit-style]').selectOption(STYLE); await sleep(500)
}
const picketQty = page => page.locator(`[data-kit="section"] [data-kit-part='${PICKET}'] [data-kit-qty]`).inputValue()
try {
  // An open quote in this style, with a walk gate.
  const q = await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify({ customerName: 'E2E Material Kits', fenceStyle: STYLE, runs: [48, 64], corners: 1, ends: 2, walkGates: 1, dblGates: 0, sections: 0, status: 'DRAFT', finalPrice: 0, date: '2026-10-17' }) })
  quoteId = q.id

  const ctx = await session()
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  await openKits(page)
  const kinds = await page.locator('[data-kit]').evaluateAll(els => els.map(e => e.getAttribute('data-kit')))
  check('Kits: section, posts, blank post, walk and double gate, each with a cost', ['section', 'corner', 'end', 'line', 'blank', 'walkGate', 'dblGate'].every(k => kinds.includes(k)) && /\$\d/.test(await page.locator('[data-kit="section"] [data-kit-cost]').textContent()), kinds.join(', '))
  const walk = await page.locator('[data-kit="walkGate"]').textContent()
  check("6'x8' walk gate leaf: 11 pickets, 6 ft rails, no insert", (await page.locator(`[data-kit="walkGate"] [data-kit-part='${PICKET}'] [data-kit-qty]`).inputValue()) === '11' && /Rail, 6'/.test(walk) && !/Rail, 8'|Insert/.test(walk))
  check('Built in kits say where they come from', /Built in/.test(await page.locator('[data-kit-status]').textContent()))
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/1-material-kits-wv-nd-6x8.png` })
    await page.locator('[data-kit="section"]').scrollIntoViewIfNeeded(); await page.locator('[data-kit="section"]').evaluate(e => e.scrollIntoView({ block: 'start' })); await sleep(300)
    await page.screenshot({ path: `${SHOTS}/1b-section-and-gate-kits.png` })
  }

  // A change lists the open quotes it would change.
  await page.locator(`[data-kit="section"] [data-kit-part='${PICKET}'] [data-kit-qty]`).fill('16'); await sleep(800)
  const row = page.locator(`[data-kit-change="${quoteId}"]`)
  check('Changing a kit lists the open quote it would change, with cost now and after', (await row.count()) === 1 && /materials \$[\d,.]+ → \$[\d,.]+/.test(await row.textContent()), (await row.count()) ? await row.textContent() : 'not listed')
  if (SHOTS) await page.locator('[data-kit-changes]').screenshot({ path: `${SHOTS}/2-open-quotes-that-would-change.png` })
  await page.locator('[data-kit-discard]').click(); await sleep(400)
  check('Discard puts the kit back', (await picketQty(page)) === '15' && (await page.locator('[data-kit-changes]').count()) === 0)

  // Duplicate and rename: no quote changes.
  await page.locator('[data-kit-duplicate]').click(); await sleep(500)
  await page.locator('[data-kit-name]').fill('WV-ND 6x8 test copy'); await sleep(500)
  check('Duplicate and rename: a copy not in use, no open quote changes', /Copy, not in use/.test(await page.locator('[data-kit-status]').textContent()) && /No open quote would change/.test(await page.locator('[data-kit-changes]').textContent()))
  await page.locator('[data-kit-discard]').click(); await sleep(400)

  // Archive: the open quote would lose its material; not saved.
  await page.locator('[data-kit-archive]').click(); await sleep(800)
  check('Archive shows the quote would lose its material', (await page.locator(`[data-kit-change="${quoteId}"]`).count()) === 1 && /→ \$0\.00/.test(await page.locator(`[data-kit-change="${quoteId}"]`).textContent()))
  await page.locator('[data-kit-discard]').click(); await sleep(400)

  // Save a change; a second browser sees it after a reload.
  await openKits(page)
  await page.locator(`[data-kit="section"] [data-kit-part='${PICKET}'] [data-kit-qty]`).fill('16'); await sleep(500)
  await page.locator('[data-kit-save]').click(); await sleep(2500)
  const stored = (await api('/api/inventory-state')).kits ?? []
  check('Saved to the server as this style\'s kit', stored.length === 1 && stored[0].styleName === STYLE && stored[0].kits.section.find(p => p.part === PICKET)?.qty === 16)
  const ctxB = await session()
  const b = await ctxB.newPage()
  await openKits(b)
  check('Second browser: the saved kit after a reload', (await picketQty(b)) === '16' && /In use/.test(await b.locator('[data-kit-status]').textContent()))

  // The quote builder prices from the kits.
  await b.goto(`${APP}/quotes?quote=${quoteId}`); await b.waitForSelector('[data-quote-builder]', { timeout: 30000 }); await sleep(1500)
  if (await b.locator('button:has-text("Show Pull Sheet")').count()) { await b.locator('button:has-text("Show Pull Sheet")').first().click(); await sleep(500) }
  const sheet = await b.locator('[data-quote-builder]').textContent()
  // 48 ft + 64 ft at 8 ft = 6 + 8 = 14 sections × 16 pickets, plus 11 for the gate leaf.
  check('Quote builder: sections take the saved kit, the gate leaf takes 6 ft parts', sheet.includes('235 × ') && sheet.includes("Vinyl, White, Rail, 6'"), (sheet.match(/Picket, 62-1\/4"\s*(\d+) ×/) || [])[1])
  if (SHOTS) await b.screenshot({ path: `${SHOTS}/3-quote-pull-sheet-from-kits.png` })
  await ctxB.close()
  check('no page errors', errors.length === 0, errors.join(' | '))
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  if (quoteId) await api(`/api/saved-quotes/${quoteId}`, { method: 'DELETE' })
  // Put the kits back, waiting out a dev server restart (up to 2 minutes).
  let r = null
  for (let i = 0; i < 24 && !r?.success; i++) { r = await putKits(keptKits).catch(() => null); if (!r?.success) await sleep(5000) }
  const backOk = !!r?.success && JSON.stringify((await api('/api/inventory-state').catch(() => ({}))).kits ?? []) === JSON.stringify(keptKits)
  if (backOk) fs.rmSync(KEPT_FILE, { force: true })
  else console.error(`The dev kits could not be put back. They are saved in ${KEPT_FILE}; the next material-kits run puts them back first.`)
  check('saved kits put back as they were', backOk)
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
