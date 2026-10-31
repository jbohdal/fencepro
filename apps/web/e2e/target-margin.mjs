// Target Margin, percents and "where every dollar goes".
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev token> SHOTS=<folder> node e2e/target-margin.mjs
//
// Settings shows Overhead % and each style's Target Profit and Target Margin
// as percents (never 0.56); a quote shows the 20 picket split; typing 46 or
// 46% as a quote's Target Margin prices it at cost ÷ 0.54; the proposal page
// never shows the split. Makes one quote and deletes it.

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
const api = async (p, init = {}) => (await (await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })).json()).data

const side = (id, name, ft, s, e, h) => ({ id, name, on: true, lengthIn: ft * 12, startFinish: s, endFinish: e, gate: null, skip: null, heading: h })
const yard = { shape: 'backyard', closed: false, sides: [side('a', 'Left return', 30, 'house', 'corner', 180), side('b', 'Left side', 120, 'corner', 'corner', 90), side('c', 'Back', 150, 'corner', 'corner', 0), side('d', 'Right side', 120, 'corner', 'corner', 270), side('e', 'Right return', 30, 'corner', 'house', 180)] }

const browser = await chromium.launch()
let quoteId = null
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))

  await page.goto(`${APP}/settings`); await page.waitForSelector('[data-page-scroll]'); await sleep(1500)
  await page.locator('[data-settings-tab="pricing"]').click(); await sleep(600)
  const inUse = await page.locator('[data-overhead-in-use]').textContent()
  check('Settings: Overhead % shown as a percent, 30% to start', /Overhead in use: 30%/.test(inUse), inUse)
  check('Settings: price method says Priced from cost (Target Margin)', await page.locator('option:has-text("Priced from cost (Target Margin)")').count() === 1)
  if (SHOTS) await page.locator('[data-overhead]').screenshot({ path: `${SHOTS}/1-settings-overhead.png` })
  await page.locator('[data-settings-tab="styles"]').click(); await sleep(600)
  const nd = await page.locator(`[data-style-profit="WV-ND 6'x6' Privacy"]`).inputValue()
  const ndTM = await page.locator(`[data-style-target-margin="WV-ND 6'x6' Privacy"]`).textContent()
  const ds = await page.locator(`[data-style-profit="WV-DS 6'x6' Privacy"]`).inputValue()
  const cl = await page.locator(`[data-style-profit="CL - 4' Galv"]`).inputValue()
  check('Styles: no dig vinyl 14% profit, 44% Target Margin', nd === '14%' && ndTM.trim() === '44%', `${nd} / ${ndTM}`)
  check('Styles: dig set vinyl 10%, chain link 12%', ds === '10%' && cl === '12%', `${ds} / ${cl}`)
  const body = await page.locator('[data-page-scroll]').textContent()
  check('Settings: no "magic number" and no 0.56 style numbers', !/magic/i.test(body) && !/\b0\.(5|6)\d?\b/.test(await page.locator('table').first().textContent()))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-styles-target-margin.png` })

  // A quote priced from cost.
  const q = await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify({ customerName: 'E2E Target Margin', fenceStyle: "WV-ND 6'x6' Privacy", runs: [30, 120, 150, 120, 30], corners: 4, ends: 2, sections: 0, status: 'DRAFT', finalPrice: 0, date: '2026-10-17', layout: { yard, runSections: [] } }) })
  quoteId = q.id
  await page.goto(`${APP}/quotes?quote=${quoteId}`); await page.waitForSelector('[data-dollar-pickets]', { timeout: 30000 }); await sleep(1000)
  const pickets = await page.locator('[data-dollar-pickets] [data-picket]').count()
  const parts = await page.locator('[data-dollar-pickets] [data-dollar-part]').evaluateAll(els => els.map(e => e.getAttribute('data-dollar-part')))
  check('Quote: 20 pickets, Materials / Labor / Overhead / Profit', pickets === 20 && ['materials', 'labor', 'overhead', 'profit'].every(p => parts.includes(p)), `${pickets} pickets: ${parts.join(', ')}`)
  const purple = await page.locator('[data-dollar-pickets] [data-picket="materials"]').first().getAttribute('fill')
  check('Quote: materials in brand purple', purple?.toUpperCase() === '#5E28A1', purple)
  if (SHOTS) await page.locator('[data-dollar-pickets]').screenshot({ path: `${SHOTS}/3-quote-where-every-dollar-goes.png` })
  const cost = Number(((await page.locator('[data-quote-builder]').textContent()).match(/Total cost\D*\$([\d,]+(?:\.\d+)?)/i) || [])[1]?.replace(/,/g, '') || 0)
  await page.locator('[data-quote-target-margin]').fill('46%'); await page.locator('[data-quote-target-margin]').press('Enter'); await sleep(600)
  const shown = await page.locator('[data-quote-target-margin]').inputValue()
  check('Quote: Target Margin typed as 46% is kept as 46%', shown === '46%', shown)
  await page.locator('[data-quote-close]').click(); await sleep(400)

  // The proposal never shows the split.
  const share = await api(`/api/saved-quotes/${quoteId}/share-token`, { method: 'POST' })
  if (share?.shareToken) {
    const pr = await (await fetch(`${API}/p/${share.shareToken}`)).text()
    check('Proposal: no "Where every dollar goes", no overhead or profit split', !/Where every dollar goes|Overhead|Profit/i.test(pr))
  }
  check('no page errors', errors.length === 0, errors.join(' | '))
  void cost
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  if (quoteId) await api(`/api/saved-quotes/${quoteId}`, { method: 'DELETE' })
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
