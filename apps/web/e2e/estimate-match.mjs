// The website widget's estimate, the /api/quotes estimate and the quote
// builder price the same three jobs to the same price.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev token> \
//   EZ_QUOTE_WIDGET_TOKEN=<dev widget token> SHOTS=<folder> node e2e/estimate-match.mjs
//
// Makes three quotes and deletes them.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const WIDGET = process.env.EZ_QUOTE_WIDGET_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const devLocal = u => /^http:\/\/localhost:\d+\/?$/.test(u) && !/:4000\b/.test(u)
if (!devLocal(API)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const post = async (p, body, token) => (await fetch(API + p, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)

const JOBS = [
  { name: 'White vinyl no dig 6x6, two runs, a walk gate', fenceStyle: "WV-ND 6'x6' Privacy", runs: [96, 150], corners: 1, ends: 2, walkGates: 1, dblGates: 0 },
  { name: 'Chain link 4 ft galvanized, a double gate', fenceStyle: "CL - 4' Galv", runs: [210, 85, 120], corners: 2, ends: 2, walkGates: 0, dblGates: 1 },
  { name: 'Aluminum no dig Emily, three runs, two gates', fenceStyle: 'Alum - ND - Emily - 48', runs: [42, 66, 38], corners: 2, ends: 2, walkGates: 2, dblGates: 0 },
]

const browser = await chromium.launch()
const made = []
const rows = []
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  for (const [i, j] of JOBS.entries()) {
    const job = { fenceStyle: j.fenceStyle, runs: j.runs, corners: j.corners, ends: j.ends, walkGates: j.walkGates, dblGates: j.dblGates }
    const widget = await post('/api/quoting/estimate', job, WIDGET)
    const api = await post('/api/quotes/calculate', job, TOKEN)
    const q = (await post('/api/saved-quotes', { customerName: `E2E Estimate match ${i + 1}`, ...job, sections: 0, status: 'DRAFT', finalPrice: 0, date: '2026-10-17' }, TOKEN)).data
    made.push(q.id)
    await page.goto(`${APP}/quotes?quote=${q.id}`); await page.waitForSelector('[data-quote-price]', { timeout: 30000 }); await sleep(1500)
    const shown = (await page.locator('[data-quote-price]').textContent()).trim()
    const builder = Number(shown.replace(/[$,]/g, ''))
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/builder-job-${i + 1}.png` })
    rows.push({ job: j.name, widget: widget.estimate, api: api.data?.price, builder, label: widget.label })
    check(`${j.name}: widget ${money(widget.estimate)} (rounded), /api/quotes ${money(api.data?.price)}, builder ${shown}`,
      widget.success && widget.label === 'Estimate' && api.data?.label === 'Estimate' && api.data.price === builder && widget.estimate === Math.round(builder))
  }
  check('the widget answer says it is an estimate, with no costs or margins', rows.every(r => r.label === 'Estimate'))
  const w = await post('/api/quoting/estimate', JOBS[0], WIDGET)
  check('widget response carries no cost, margin or parts', !('materialCost' in w) && !('pullSheet' in w) && !('grossMargin' in w))
  console.log('\n| Job | Website widget | /api/quotes | Quote builder |\n|---|---|---|---|')
  for (const r of rows) console.log(`| ${r.job} | ${money(r.widget)} | ${money(r.api)} | ${money(r.builder)} |`)
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  for (const id of made) await fetch(`${API}/api/saved-quotes/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` } })
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
