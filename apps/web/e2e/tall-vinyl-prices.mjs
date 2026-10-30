// 8 ft tall vinyl priced by the piece (Jonathan, Oct 21, 2026): Settings → Price List → 8 ft tall vinyl.
//
//   E2E_ACCESS_TOKEN=<dev owner token> APP_URL=http://localhost:4001 SHOTS=<folder, optional> node e2e/tall-vinyl-prices.mjs
//
// Dev only (4001). White 8'x8' no dig starts with no prices: the row says
// "Not available for quoting" and the server will not estimate it. Browser A
// types a section and a post price and saves; the server has them in integer
// cents; browser B (fresh) sees them after a reload with "Available for
// quoting", and the server now estimates the style, with the section and post
// piece lines on the pull sheet and the section parts at $0. The style's
// prices are put back as they were.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // tests that change shared dev data take turns
import { chromium } from 'playwright'
const APP = process.env.APP_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || '', SHOTS = process.env.SHOTS || ''
if (!/localhost:4001/.test(APP)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (p, init = {}) => (await fetch(APP + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })).json()
const STYLE = "WV-ND 8'x8' Privacy"
const bs = async () => (await call('/api/business-state')).data
const styleNow = async () => (await bs()).config.fenceStyles.find(s => s.name === STYLE)
async function setPieces(pieceCents) {
  for (let i = 0; i < 5; i++) {
    const s = await bs()
    const fenceStyles = s.config.fenceStyles.map(st => { if (st.name !== STYLE) return st; const c = { ...st }; if (pieceCents) c.pieceCents = pieceCents; else delete c.pieceCents; return c })
    const r = await call('/api/business-state', { method: 'PATCH', body: JSON.stringify({ config: { ...s.config, fenceStyles }, baseVersion: s.version }) })
    if (r.success) return
  }
  throw new Error('could not save the style')
}
const estimate = () => call('/api/quotes/calculate', { method: 'POST', body: JSON.stringify({ fenceStyle: STYLE, runs: [48], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, adjLaborHrs: 0 }) })
/** The server reads Settings again every few seconds. */
async function settle(quotable) { for (let i = 0; i < 15; i++) { const r = await estimate(); if (!!r.success === quotable) return r; await sleep(1000) } return estimate() }

const kept = (await styleNow())?.pieceCents ?? null
const browser = await chromium.launch()
const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  await page.goto(`${APP}/settings?tab=price_list`); await page.waitForSelector('[data-tall-prices]', { timeout: 60000 }); await sleep(800)
  return { ctx, page, errs }
}
const row = (page) => page.locator(`[data-tall-row="${STYLE}"]`)
try {
  await setPieces(null)
  const held = await settle(false)
  check('no prices: the server will not estimate it (not available for quoting)', !held.success, held.error || held.data?.message)

  const a = await open()
  check('Settings → Price List lists the 8 ft tall fences', (await a.page.locator('[data-tall-row]').count()) >= 4, String(await a.page.locator('[data-tall-row]').count()))
  check('no prices: the row says Not available for quoting', /Not available for quoting: enter the section and post prices/.test(await row(a.page).textContent()))
  await a.page.locator(`[data-tall-price="${STYLE}|section"]`).fill('412.50')
  await a.page.locator(`[data-tall-price="${STYLE}|post"]`).fill('65')
  await a.page.locator('[data-tall-save]').click(); await sleep(2500)
  const saved = (await styleNow())?.pieceCents
  check('saved on the server in integer cents, dated', saved?.section === 41250 && saved?.post === 6500 && /^\d{4}-\d{2}-\d{2}$/.test(saved?.pricedOn ?? ''), JSON.stringify(saved))
  check('browser A: the row says Available for quoting', !!(await row(a.page).locator('[data-tall-ready]').count()))
  if (SHOTS) { await row(a.page).scrollIntoViewIfNeeded(); await a.page.screenshot({ path: `${SHOTS}/tall-vinyl-prices.png` }) }

  const b = await open()
  const vals = [await b.page.locator(`[data-tall-price="${STYLE}|section"]`).inputValue(), await b.page.locator(`[data-tall-price="${STYLE}|post"]`).inputValue()]
  check('browser B after a reload: the same prices, available for quoting', vals.join('|') === '412.50|65.00' && !!(await row(b.page).locator('[data-tall-ready]').count()), vals.join('|'))

  const est = await settle(true)
  const sheet = est.data?.pullSheet ?? est.data?.materials ?? est.data?.items ?? []
  check('the server estimates it now', !!est.success, est.error || '')
  const names = JSON.stringify(est.data ?? {})
  check('pull sheet: the section and post piece lines, and the 4 ft pickets', /8 ft tall White: section, 8 ft wide/.test(names) && /8 ft tall White: end post/.test(names) && /Picket, 4'/.test(names), `${Array.isArray(sheet) ? sheet.length : 0} lines`)
  check('no page errors', a.errs.length + b.errs.length === 0, [...a.errs, ...b.errs].join(' | '))
  await a.ctx.close(); await b.ctx.close()
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  await setPieces(kept).catch(() => {})
  check('the style\'s prices put back as they were', JSON.stringify((await styleNow())?.pieceCents ?? null) === JSON.stringify(kept))
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
