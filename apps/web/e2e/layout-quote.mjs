// Layout first quoting, in a browser on the dev copy.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> node e2e/layout-quote.mjs
//
// On a phone sized screen: pick Backyard, type the five sides on the number
// pad, add a walk gate and a double gate, pick a style; the sections, posts
// and price must match the same job typed as a run list. Then save, reopen
// on a computer sized screen and check the layout and post spacing came back.
// The test quote is deleted at the end.

import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:5173'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async (path, init = {}) => {
  const r = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  const j = await r.json().catch(() => ({}))
  return j.data ?? j
}

async function open(browser, phone) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 1000 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  await page.goto(APP)
  await page.waitForSelector(phone ? '[data-tabbar]' : '[data-global-appointment]', { timeout: 30000 }); await sleep(800)
  return { ctx, page, errors }
}

async function typeLength(page, keys) {
  for (const k of keys) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
}

const browser = await chromium.launch()
let savedId = null
try {
  // ── Phone: build the backyard ──
  const s = await open(browser, true)
  const p = s.page
  const t0 = Date.now()
  let taps = 0
  const tap = async loc => { taps += 1; await loc.click() }
  await tap(p.locator('button:has-text("New quote"):visible').first())
  const b = p.locator('[data-quote-builder]')
  await b.locator('input[placeholder^="Customer name"]').fill('Layout test (e2e)')
  await tap(b.locator('[data-shape="backyard"]'))
  // Lengths: tap the first side, then Next through the rest.
  await tap(b.locator('[data-side="Left return"] [data-side-length]'))
  for (const [keys, last] of [[['3', '0'], false], [['1', '2', '0'], false], [['1', '5', '0'], false], [['1', '2', '0'], false], [['3', '0'], true]]) {
    for (const k of keys) await tap(p.locator(`[data-ftin-pad] [data-pad-key="${k}"]`))
    await tap(p.locator(last ? '[data-ftin-pad] [data-pad-done]' : '[data-ftin-pad] [data-pad-next]'))
  }
  await tap(b.locator('[data-side="Left return"] [data-gate-choice] button:has-text("Walk gate")'))
  await tap(b.locator('[data-side="Right return"] [data-gate-choice] button:has-text("Double gate")'))
  await b.locator('select').filter({ hasText: 'Select a fence style' }).selectOption({ label: "WV-ND 6'x8' Privacy" }); taps += 1
  await sleep(500)
  const secs = Math.round((Date.now() - t0) / 1000)

  const total = async () => (await b.locator('text=Total sections').locator('xpath=following-sibling::span[1]').textContent()).trim()
  const price = async () => (await b.locator('text=Adjusted Price').locator('xpath=following-sibling::p[1]').textContent()).trim()
  const sections = await total()
  const posts = (await b.locator('[data-post-counts] p').nth(1).textContent()).trim()
  const leftRuns = (await b.locator('[data-side="Left return"] [data-side-runs]').textContent()).trim()
  const layoutPrice = await price()
  await p.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/phone-layout-top.png` : '/dev/null' }).catch(() => {})
  check('phone: backyard with two gated returns gives 57 sections', sections === '57', sections)
  check('phone: posts are counted from the finishes: 4 corner, 6 end (4 at gates)', /^4 corner · 6 end \(4 at gates\)/.test(posts), posts)
  check('phone: the left return is split around its gate, with post spacing', /Piece 1: 13' 0" = 2 sections, posts 6' 6" apart/.test(leftRuns), leftRuns)
  check('phone: quoted in under 2 minutes of tapping', taps <= 25, `${taps} taps, ${secs}s for the test robot`)

  // The same job typed as a run list prices the same.
  await b.locator('[data-to-advanced]').click(); await sleep(300)
  const typed = await b.locator('input[placeholder="Length in feet"]').evaluateAll(els => els.map(e => e.value))
  const typedPrice = await price()
  check('advanced view gets exactly the layout\'s runs', typed.join(',') === '13,13,120,150,120,10,10', typed.join(','))
  check('and the same price', typedPrice === layoutPrice, `${layoutPrice} vs ${typedPrice}`)
  await b.locator('[data-to-layout]').click(); await sleep(300)
  check('back to the layout keeps the sides', (await total()) === '57')

  // Pinned totals on the phone.
  const sticky = (await p.locator('[data-quote-sticky]').textContent()).trim()
  check('phone: footage, sections and price pinned at the bottom', sticky.includes('436 ft · 57 sections') && sticky.includes(layoutPrice), sticky)

  // Save to a dev customer.
  await p.locator('[data-quote-sticky] button:has-text("Save quote")').click()
  await p.locator('input[placeholder="Name, phone, or email..."]').fill('Shawn Collins'); await sleep(400)
  await p.locator('text=Shawn Collins').last().click()
  await p.locator('button:has-text("Save quote")').last().click()
  await sleep(2500)
  check('phone: no page errors', s.errors.length === 0, s.errors.join(' | '))
  await s.ctx.close()

  const list = await api('/api/saved-quotes')
  const saved = (Array.isArray(list) ? list : list.quotes || []).filter(q => q.layout?.yard?.shape === 'backyard' && q.customerName === 'Shawn Collins').sort((a, z) => String(z.createdAt).localeCompare(String(a.createdAt)))[0]
  savedId = saved?.id
  check('saved with its layout and sections per run', !!saved && saved.layout.yard.sides.length === 5 && saved.layout.runSections.join(',') === '2,2,15,19,15,2,2',
    saved ? `${saved.runs.join(',')} | ${saved.layout.runSections.join(',')}` : 'not found')

  // ── Computer: reopen the saved quote ──
  const d = await open(browser, false)
  await d.page.keyboard.press('Meta+k')
  await d.page.keyboard.type('Shawn Collins'); await sleep(600)
  await d.page.locator('[data-global-search] [role="option"]:has-text("WV-ND 6\'x8\'")').first().locator('button').first().click()
  await sleep(800)
  const reopened = await d.page.locator('[data-quote-builder] [data-side]').count()
  if (process.env.SHOTS) await d.page.screenshot({ path: `${process.env.SHOTS}/desktop-layout-reopened.png` })
  check('the saved quote reopens on its yard layout', reopened === 5, `${reopened} sides`)
  await d.page.locator('[data-quote-builder] button[aria-label="Close"]').click(); await sleep(400)

  // The crew sees runs by side with post spacing on the customer's quote.
  await d.page.goto(`${APP}/?customer=${saved.crmContactId}`)
  await d.page.waitForSelector('[data-global-appointment]'); await sleep(1000)
  await d.page.locator('button.capitalize', { hasText: /^quotes/i }).first().click(); await sleep(500)
  await d.page.locator(`text=$${Math.round(saved.finalPrice).toLocaleString('en-US')}`).first().click(); await sleep(800)
  const runTable = (await d.page.locator('[data-run-spacing]').first().textContent()).replace(/\s+/g, ' ')
  if (process.env.SHOTS) await d.page.screenshot({ path: `${process.env.SHOTS}/desktop-quote-drawer-runs.png` })
  check('the saved quote lists runs by side with post spacing', runTable.includes('Left return (1 of 2)') && runTable.includes(`7' 10 3/4"`), runTable.slice(0, 160))
  check('desktop: no page errors', d.errors.length === 0, d.errors.join(' | '))
  await d.ctx.close()
} catch (e) {
  check('test run finished', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  if (savedId) await api(`/api/saved-quotes/${savedId}`, { method: 'DELETE' })
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
